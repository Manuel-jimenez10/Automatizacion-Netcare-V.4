import { env } from '../config/env';
import {
  EspoCRMContact,
  EspoCRMWhatsappTemplate,
} from '../interfaces/interfaces';
import { extractAndValidatePhone } from '../utils/phone-utils';
import { EspoCRMClient } from './espocrm-api-client.service';
import { sendDynamicTemplateMessage } from './twilio.service';

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_DELAY_MS = 1500;
const MAX_RECORDED_ERRORS = 200;

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
  listEntitiesPage<T>(
    entityType: string,
    params: {
      offset?: number;
      maxSize?: number;
      select?: string;
      where?: any[];
      orderBy?: string;
      order?: 'asc' | 'desc';
    },
  ): Promise<{ list: T[]; total: number }>;
  searchEntities(entityType: string, where?: any): Promise<any[]>;
  createEntity(entityType: string, data: any): Promise<any>;
  updateEntity(entityType: string, entityId: string, data: any): Promise<void>;
}

export interface WhatsappAllContactsServiceOptions {
  espoCRMClient?: AllContactsEspoClient;
  sendTemplateMessage?: TemplateMessageSender;
  pageSize?: number;
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
 * Envia un WhatsappTemplate a todos los Contact que tengan valor en `phone`.
 * No usa reportes: recorre la entidad Contact directamente y por paginas.
 */
export class WhatsappAllContactsService {
  private readonly espoCRMClient: AllContactsEspoClient;
  private readonly sendTemplateMessage: TemplateMessageSender;
  private readonly pageSize: number;
  private readonly delayMs: number;

  constructor(options: WhatsappAllContactsServiceOptions = {}) {
    this.espoCRMClient = options.espoCRMClient || new EspoCRMClient();
    this.sendTemplateMessage = options.sendTemplateMessage || sendDynamicTemplateMessage;
    this.pageSize = options.pageSize || DEFAULT_PAGE_SIZE;
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

    const attachmentUrl = `${env.publicUrl}/api/files/${template.archivoAdjuntoId}`;
    const progress = createInitialAllContactsProgress();
    const processedPhones = new Set<string>();
    let offset = 0;

    console.log(`📋 Template: "${template.name}" (ID: ${template.id})`);
    console.log(`   - SID Twilio: ${template.whatsappTemplateSID}`);
    console.log(`   - Imagen publica: ${attachmentUrl}`);
    console.log('   - Audiencia: todos los Contact con phone');

    while (true) {
      const page = await this.espoCRMClient.listEntitiesPage<EspoCRMContact>(
        'Contact',
        {
          offset,
          maxSize: this.pageSize,
          select: 'id,name,phone',
          where: [
            {
              type: 'isNotNull',
              attribute: 'phone',
            },
          ],
          orderBy: 'id',
          order: 'asc',
        },
      );

      if (page.total >= 0) {
        progress.totalContacts = page.total;
      }

      if (page.list.length === 0) {
        break;
      }

      console.log(
        `\n📄 Contactos ${offset + 1}-${offset + page.list.length}` +
        `${progress.totalContacts !== null ? ` de ${progress.totalContacts}` : ''}`,
      );

      for (const contact of page.list) {
        await this.processContact(
          contact,
          template,
          attachmentUrl,
          processedPhones,
          progress,
        );

        onProgress?.(this.cloneProgress(progress));
      }

      offset += page.list.length;

      if (page.list.length < this.pageSize) {
        break;
      }
    }

    if (progress.totalContacts === null) {
      progress.totalContacts = progress.processed;
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

  private validateTemplate(template: EspoCRMWhatsappTemplate): void {
    if (!template.whatsappTemplateSID) {
      throw new Error(
        `El template "${template.name}" no tiene SID de Twilio configurado.`,
      );
    }

    if (!template.archivoAdjuntoId) {
      throw new Error(
        `El template "${template.name}" no tiene Archivo Adjunto. La variable {{2}} requiere una imagen.`,
      );
    }
  }

  private async processContact(
    contact: EspoCRMContact,
    template: EspoCRMWhatsappTemplate,
    attachmentUrl: string,
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
    const contactName = contact.name?.trim() || 'Cliente';

    try {
      const twilioResponse = await this.sendTemplateMessage({
        phone: validPhone,
        contentSid: template.whatsappTemplateSID,
        contentVariables: {
          '1': contactName,
          '2': attachmentUrl,
        },
      });

      await this.logMessageInEspo(
        template,
        contact,
        validPhone,
        twilioResponse,
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
    contact: EspoCRMContact,
    phone: string,
    twilioResponse: any,
  ): Promise<void> {
    try {
      const conversations = await this.espoCRMClient.searchEntities(
        'WhatsappConverstion',
        [
          {
            type: 'equals',
            attribute: 'name',
            value: phone,
          },
        ],
      );

      const conversationId = conversations[0]?.id;
      const description = template.contentMessageTemplate ||
        `Template ${template.name} enviado a ${contact.name || 'Cliente'}`;

      const messagePayload: any = {
        name: phone,
        contact: phone,
        contactId: contact.id,
        status: 'Sent',
        type: 'Out',
        description,
        messageSid: twilioResponse.sid,
        isRead: false,
        archivoAdjuntoId: template.archivoAdjuntoId,
      };

      if (conversationId) {
        messagePayload.whatsappConverstionId = conversationId;
      }

      await this.espoCRMClient.createEntity('WhatsappMessage', messagePayload);

      if (conversationId) {
        await this.espoCRMClient.updateEntity(
          'WhatsappConverstion',
          conversationId,
          {
            description: description.substring(0, 100),
            fechaHoraUltimoMensaje: new Date()
              .toISOString()
              .slice(0, 19)
              .replace('T', ' '),
          },
        );
      }
    } catch (error: any) {
      console.error(
        '   ⚠️ El mensaje se envio, pero no se pudo registrar en EspoCRM:',
        error.message,
      );
    }
  }

  private recordError(
    progress: AllContactsSendProgress,
    contact: EspoCRMContact,
    phone: string,
    error: string,
  ): void {
    if (progress.errors.length >= MAX_RECORDED_ERRORS) {
      return;
    }

    progress.errors.push({
      contactId: contact.id,
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
