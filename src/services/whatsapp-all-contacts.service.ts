import axios from 'axios';
import { env } from '../config/env';
import { EspoCRMWhatsappTemplate } from '../interfaces/interfaces';
import { extractAndValidatePhone } from '../utils/phone-utils';
import { EspoCRMClient } from './espocrm-api-client.service';
import { sendDynamicTemplateMessage } from './twilio.service';

const CONTACTS_REPORT_ID = '69c1bf528b8fb6477';
const DEFAULT_DELAY_MS = 1500;
const MAX_RECORDED_ERRORS = 200;

interface ReportContact {
  id?: string;
  name: string;
  phone: string;
}

export interface AllContactsSendError {
  contactId: string;
  contact: string;
  phone: string;
  error: string;
}

export interface AllContactsSendProgress {
  totalContacts: number | null;
  processed: number;
  sent: number;
  failed: number;
  skippedWithoutPhone: number;
  skippedDuplicatePhone: number;
  errors: AllContactsSendError[];
}

interface TemplateMessageSender {
  (params: {
    phone: string;
    contentSid: string;
    contentVariables: Record<string, string>;
  }): Promise<any>;
}

interface AllContactsEspoClient {
  getEntity(entityType: string, entityId: string): Promise<any>;
  request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    data?: any,
  ): Promise<any>;
  searchEntities(entityType: string, where?: any): Promise<any[]>;
  createEntity(entityType: string, data: any): Promise<any>;
  updateEntity(entityType: string, entityId: string, data: any): Promise<void>;
}

interface ReportContactsLoader {
  (reportId: string): Promise<ReportContact[]>;
}

export interface WhatsappAllContactsServiceOptions {
  espoCRMClient?: AllContactsEspoClient;
  sendTemplateMessage?: TemplateMessageSender;
  reportContactsLoader?: ReportContactsLoader;
  delayMs?: number;
}

export const createInitialAllContactsProgress = (): AllContactsSendProgress => ({
  totalContacts: null,
  processed: 0,
  sent: 0,
  failed: 0,
  skippedWithoutPhone: 0,
  skippedDuplicatePhone: 0,
  errors: [],
});

/**
 * Envia un WhatsappTemplate a los Contact incluidos en el reporte configurado.
 * El reporte filtra los contactos con Phone y exporta name + phone/phoneNumber.
 */
export class WhatsappAllContactsService {
  private readonly espoCRMClient: AllContactsEspoClient;
  private readonly sendTemplateMessage: TemplateMessageSender;
  private readonly reportContactsLoader?: ReportContactsLoader;
  private readonly delayMs: number;

  constructor(options: WhatsappAllContactsServiceOptions = {}) {
    this.espoCRMClient = options.espoCRMClient || new EspoCRMClient();
    this.sendTemplateMessage = options.sendTemplateMessage || sendDynamicTemplateMessage;
    this.reportContactsLoader = options.reportContactsLoader;
    this.delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  }

  async handleAllContactsSend(
    templateRecordId: string,
    onProgress?: (progress: AllContactsSendProgress) => void,
  ): Promise<AllContactsSendProgress> {
    console.log('\n🚀 ============================================');
    console.log(`🚀 Iniciando template para TODOS los Contacts: ${templateRecordId}`);
    console.log('🚀 ============================================\n');

    const template = await this.espoCRMClient.getEntity(
      'WhatsappTemplate',
      templateRecordId,
    ) as EspoCRMWhatsappTemplate;

    this.validateTemplate(template);

    const progress = createInitialAllContactsProgress();
    const processedPhones = new Set<string>();

    console.log(`📋 Template: "${template.name}" (ID: ${template.id})`);
    console.log(`   - SID Twilio: ${template.whatsappTemplateSID}`);
    console.log('   - Imagen: estatica dentro del template multimedia de Twilio');
    const testRecipients = this.getTestRecipients();
    const enTestMode = testRecipients.length > 0;

    let contacts: ReportContact[];
    if (enTestMode) {
      console.log('🧪 ============================================');
      console.log(`🧪 MODO PRUEBA (BULK_TEST_RECIPIENTS): solo ${testRecipients.length} numero(s), se ignora el reporte`);
      testRecipients.forEach(r => console.log(`   - ${r.phone}`));
      console.log('🧪 ============================================');
      contacts = testRecipients;
    } else {
      const reportId = this.getReportId();
      console.log(`   - Audiencia: reporte ${reportId}`);
      contacts = this.reportContactsLoader
        ? await this.reportContactsLoader(reportId)
        : await this.exportReportAndParseContacts(reportId);
    }

    progress.totalContacts = contacts.length;
    console.log(`\n📊 Contactos a procesar: ${contacts.length}`);

    for (const contact of contacts) {
      await this.processContact(
        contact,
        template,
        processedPhones,
        progress,
      );

      onProgress?.(this.cloneProgress(progress));
    }

    console.log('\n✅ ============================================');
    console.log(`✅ Envio masivo finalizado: ${progress.sent} enviados`);
    console.log(`   - Procesados: ${progress.processed}`);
    console.log(`   - Fallidos: ${progress.failed}`);
    console.log(`   - Sin phone: ${progress.skippedWithoutPhone}`);
    console.log(`   - Telefonos duplicados: ${progress.skippedDuplicatePhone}`);
    console.log('✅ ============================================\n');

    onProgress?.(this.cloneProgress(progress));
    return progress;
  }

  /**
   * Lista de prueba opcional (env BULK_TEST_RECIPIENTS). Si esta definida, el
   * envio masivo ignora el reporte y solo manda a estos numeros. Vaciar la
   * variable para volver al envio normal a todos los contactos.
   */
  private getTestRecipients(): ReportContact[] {
    const raw = env.bulkTestRecipients;
    if (!raw || !raw.trim()) {
      return [];
    }

    return raw
      .split(',')
      .map(value => value.trim())
      .filter(value => value !== '')
      .map(phone => ({ name: 'Prueba', phone }));
  }

  /**
   * ID del Report que define la audiencia. Usa BULK_CONTACTS_REPORT_ID si esta
   * definida; de lo contrario cae al reporte por defecto del codigo.
   */
  private getReportId(): string {
    const configured = env.bulkContactsReportId?.trim();
    return configured || CONTACTS_REPORT_ID;
  }

  /** Reutiliza el mismo mecanismo de exportacion CSV del modulo funcional. */
  private async exportReportAndParseContacts(
    reportId: string,
  ): Promise<ReportContact[]> {
    console.log(`\n📄 Exportando reporte ${reportId} a CSV...`);

    const exportResponse = await this.espoCRMClient.request(
      'POST',
      'Report/action/exportList',
      { id: reportId, format: 'csv' },
    );

    if (!exportResponse.id) {
      throw new Error('EspoCRM no devolvio el ID del CSV exportado.');
    }

    let baseUrl = env.espocrmBaseUrl;
    baseUrl = baseUrl.replace(/\/api\/v1\/?$/, '').replace(/\/$/, '');
    const downloadUrl = `${baseUrl}/?entryPoint=download&id=${exportResponse.id}`;

    const downloadResponse = await axios.get(downloadUrl, {
      headers: { 'X-Api-Key': env.espocrmApiKey },
      responseType: 'arraybuffer',
    });

    const csvContent = Buffer.from(downloadResponse.data).toString('utf-8');
    const lines = csvContent
      .split(/\r?\n/)
      .filter((line: string) => line.trim() !== '');

    if (lines.length < 2) {
      return [];
    }

    const headers = lines[0]
      .replace(/^\uFEFF/, '')
      .split(';')
      .map(header => header.replace(/^"|"$/g, '').trim());
    const idIdx = headers.indexOf('id');
    const nameIdx = headers.indexOf('name');
    let phoneIdx = headers.indexOf('phoneNumber');

    if (phoneIdx === -1) {
      phoneIdx = headers.indexOf('phone');
    }

    if (nameIdx === -1 || phoneIdx === -1) {
      throw new Error(
        `El reporte no tiene las columnas requeridas (name y phone o phoneNumber). ` +
        `Columnas encontradas: ${headers.join(', ')}`,
      );
    }

    const contacts: ReportContact[] = [];
    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].split(';');
      const id = idIdx >= 0 ? this.cleanCsvValue(row[idIdx]) : undefined;
      const name = this.cleanCsvValue(row[nameIdx]);
      const phone = this.cleanCsvValue(row[phoneIdx]).replace(/^'/, '');

      if (name || phone) {
        contacts.push({ id, name, phone });
      }
    }

    return contacts;
  }

  private cleanCsvValue(value?: string): string {
    return (value || '').replace(/^"|"$/g, '').trim();
  }

  private validateTemplate(template: EspoCRMWhatsappTemplate): void {
    if (!template.whatsappTemplateSID) {
      throw new Error(
        `El template "${template.name}" no tiene SID de Twilio configurado.`,
      );
    }

  }

  private async processContact(
    contact: ReportContact,
    template: EspoCRMWhatsappTemplate,
    processedPhones: Set<string>,
    progress: AllContactsSendProgress,
  ): Promise<void> {
    progress.processed++;

    const rawPhone = typeof contact.phone === 'string' ? contact.phone.trim() : '';
    if (!rawPhone) {
      progress.skippedWithoutPhone++;
      return;
    }

    const phoneValidation = extractAndValidatePhone({ phone: rawPhone });
    if (!phoneValidation.isValid || !phoneValidation.formattedNumber) {
      progress.failed++;
      this.recordError(progress, contact, rawPhone, phoneValidation.error || 'Telefono invalido');
      return;
    }

    const validPhone = phoneValidation.formattedNumber;
    if (processedPhones.has(validPhone)) {
      progress.skippedDuplicatePhone++;
      console.log(`   ↪ Telefono duplicado omitido: ${validPhone}`);
      return;
    }

    processedPhones.add(validPhone);
    // Las variables de templates aprobados no admiten saltos de linea ni
    // secuencias largas de espacios. El fallback evita valores vacios.
    const contactName = this.sanitizeTemplateVariable(contact.name, 'Cliente');

    try {
      const twilioResponse = await this.sendTemplateMessage({
        phone: validPhone,
        contentSid: template.whatsappTemplateSID,
        contentVariables: {
          '1': contactName,
        },
      });

      const sentMessageText = this.getActualSentMessage(
        twilioResponse,
        contactName,
      );

      await this.logMessageInEspo(
        template,
        contact,
        validPhone,
        twilioResponse,
        sentMessageText,
      );

      progress.sent++;
      console.log(`   ✅ Enviado a ${contactName} (${validPhone})`);
    } catch (error: any) {
      progress.failed++;
      this.recordError(progress, contact, validPhone, error.message);
      console.error(`   ❌ Error enviando a ${contactName}: ${error.message}`);
    } finally {
      if (this.delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, this.delayMs));
      }
    }
  }

  private async logMessageInEspo(
    template: EspoCRMWhatsappTemplate,
    contact: ReportContact,
    phone: string,
    twilioResponse: any,
    sentMessageText: string,
  ): Promise<void> {
    try {
      // El mensaje se guarda SOLO en WhatsappMessage, con el telefono del
      // destinatario en 'name'. El workflow de EspoCRM lo empareja con el
      // Contact y la conversacion a partir de ese numero (conversacion vacia aqui).
      const messagePayload: any = {
        name: phone,
        contact: phone,
        status: 'Sent',
        type: 'Out',
        description: sentMessageText,
        messageSid: twilioResponse.sid,
        isRead: false,
      };

      if (template.archivoAdjuntoId) {
        messagePayload.archivoAdjuntoId = template.archivoAdjuntoId;
      }

      if (contact.id) {
        messagePayload.contactId = contact.id;
      }

      console.log('   📤 [WhatsappMessage] Campos a guardar en EspoCRM:');
      console.log(`      - Name (telefono destinatario): ${messagePayload.name}`);
      console.log(`      - Mensaje (description): ${messagePayload.description}`);
      console.log(`      - Conversacion: ${messagePayload.whatsappConverstionId || '(vacia)'}`);
      console.log(`      - Tipo: ${messagePayload.type}`);
      console.log(`      - Status: ${messagePayload.status}`);

      await this.espoCRMClient.createEntity('WhatsappMessage', messagePayload);
    } catch (error: any) {
      console.error(
        '   ⚠️ El mensaje se envio, pero no se pudo registrar en EspoCRM:',
        error.message,
      );
    }
  }

  private getActualSentMessage(twilioResponse: any, contactName: string): string {
    if (typeof twilioResponse?.body === 'string' && twilioResponse.body.trim()) {
      return twilioResponse.body.trim();
    }

    console.warn(
      `   ⚠️ Twilio no devolvio body para ${contactName}; se guardara un indicador sin usar contentMessageTemplate.`,
    );
    return `Mensaje de WhatsApp enviado a ${contactName}`;
  }

  private sanitizeTemplateVariable(value: string | undefined, fallback: string): string {
    const sanitized = (value || '').replace(/\s+/g, ' ').trim();
    return sanitized || fallback;
  }

  private recordError(
    progress: AllContactsSendProgress,
    contact: ReportContact,
    phone: string,
    error: string,
  ): void {
    if (progress.errors.length >= MAX_RECORDED_ERRORS) {
      return;
    }

    progress.errors.push({
      contactId: contact.id || '',
      contact: contact.name || '',
      phone,
      error,
    });
  }

  private cloneProgress(progress: AllContactsSendProgress): AllContactsSendProgress {
    return {
      ...progress,
      errors: progress.errors.map(error => ({ ...error })),
    };
  }
}
