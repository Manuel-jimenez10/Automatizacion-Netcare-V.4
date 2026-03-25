import axios from 'axios';
import { EspoCRMClient } from './espocrm-api-client.service';
import { sendDynamicTemplateMessage } from './twilio.service';
import { env } from '../config/env';
import { EspoCRMWhatsappTemplate } from '../interfaces/interfaces';
import { extractAndValidatePhone } from '../utils/phone-utils';

interface TemplateSendResult {
  totalContacts: number;
  sent: number;
  failed: number;
  errors: { contact: string; phone: string; error: string }[];
}

export class WhatsappTemplateService {
  private espoCRMClient: EspoCRMClient;

  constructor() {
    this.espoCRMClient = new EspoCRMClient();
  }

  /**
   * Flujo principal: recibe el ID del registro WhatsappTemplate,
   * obtiene los datos, extrae contactos del reporte y envía el template.
   */
  async handleTemplateSend(templateRecordId: string): Promise<TemplateSendResult> {
    console.log('\n🚀 ============================================');
    console.log(`🚀 Iniciando envío de Template dinámico: ${templateRecordId}`);
    console.log('🚀 ============================================\n');

    try {
      // 1. Obtener el registro WhatsappTemplate desde EspoCRM
      const template = await this.espoCRMClient.getEntity(
        'WhatsappTemplate', templateRecordId
      ) as EspoCRMWhatsappTemplate;

      // DEBUG: Ver todos los campos que devuelve EspoCRM
      console.log('🔍 [DEBUG] Todos los campos del registro WhatsappTemplate:');
      console.log(JSON.stringify(template, null, 2));

      // Limpiar etiquetas HTML del contenido del mensaje para enviar como texto plano.
      // NOTA: WhatsApp PROHÍBE estrictamente los saltos de línea (\n) dentro de variables ({{1}}).
      // Por ende, reemplazamos todos los divs, br y p con un espacio para separar las frases,
      // pero sin poner Enters.
      if (template.contentMessageTemplate) {
        template.contentMessageTemplate = template.contentMessageTemplate
          .replace(/<div><br><\/div>/gi, ' ')
          .replace(/<\/div><div>/gi, ' ')
          .replace(/<br\s*\/?>/gi, ' ')
          .replace(/<\/p><p>/gi, ' ')
          .replace(/<[^>]+>/g, '') // Elimina cualquier otra etiqueta HTML
          .replace(/&nbsp;/g, ' ')
          .replace(/\n+/g, ' ') // Elimina Enters nativos si los hubiera
          .trim();
      }

      console.log(`📋 Template: "${template.name}" (ID: ${template.id})`);
      console.log(`   - SID Twilio: ${template.whatsappTemplateSID}`);
      console.log(`   - Contenido limpio: ${template.contentMessageTemplate}`);

      // reportId hardcodeado pedido por el usuario
      const reportId = '69c1bf528b8fb6477';
      console.log(`   - Reporte ID a usar (fijo): ${reportId}`);

      // Validar campos requeridos
      if (!template.whatsappTemplateSID) {
        throw new Error(`El template "${template.name}" no tiene SID de Twilio configurado.`);
      }
      if (!template.contentMessageTemplate) {
        throw new Error(`El template "${template.name}" no tiene contenido de mensaje.`);
      }

      // 2. Exportar el reporte a CSV y obtener los contactos
      const contacts = await this.exportReportAndParseContacts(reportId);

      if (contacts.length === 0) {
        console.log('⚠️ El reporte no tiene contactos. No se enviará ningún mensaje.');
        return { totalContacts: 0, sent: 0, failed: 0, errors: [] };
      }

      console.log(`\n📊 Total de contactos en el reporte: ${contacts.length}`);

      // 3. Preparar URL del archivo adjunto (si existe)
      let attachmentUrl: string | undefined;
      if (template.archivoAdjuntoId) {
        attachmentUrl = `${env.publicUrl}/api/files/${template.archivoAdjuntoId}`;
        console.log(`📎 Archivo adjunto detectado. URL pública: ${attachmentUrl}`);
      }

      // 4. Enviar template a cada contacto
      const result = await this.sendToContacts(
        contacts,
        template,
        attachmentUrl,
      );

      // 5. Resumen final
      console.log('\n✅ ============================================');
      console.log(`✅ Envío completado: ${result.sent}/${result.totalContacts} exitosos`);
      if (result.failed > 0) {
        console.log(`❌ Fallidos: ${result.failed}`);
      }
      console.log('✅ ============================================\n');

      return result;

    } catch (error: any) {
      console.log('\n❌ ============================================');
      console.log(`❌ Error crítico en el proceso: ${error.message}`);
      console.log('❌ ============================================\n');
      throw error;
    }
  }

  /**
   * Exporta el reporte como CSV y extrae los contactos (name, phoneNumber).
   */
  private async exportReportAndParseContacts(
    reportId: string
  ): Promise<{ name: string; phoneNumber: string }[]> {
    console.log(`\n📄 Exportando reporte ${reportId} a CSV...`);

    // Exportar reporte desde EspoCRM
    const exportResponse = await this.espoCRMClient.request(
      'POST',
      'Report/action/exportList',
      { id: reportId, format: 'csv' }
    );

    const attachmentId = exportResponse.id;
    console.log(`   ✓ CSV generado. Attachment ID: ${attachmentId}`);

    // Descargar el CSV
    let baseUrl = env.espocrmBaseUrl;
    baseUrl = baseUrl.replace(/\/api\/v1\/?$/, '');
    baseUrl = baseUrl.replace(/\/$/, '');

    const downloadUrl = `${baseUrl}/?entryPoint=download&id=${attachmentId}`;
    console.log(`   📥 Descargando CSV desde: ${downloadUrl}`);

    const downloadResponse = await axios.get(downloadUrl, {
      headers: { 'X-Api-Key': env.espocrmApiKey },
      responseType: 'arraybuffer',
    });

    const csvContent = Buffer.from(downloadResponse.data).toString('utf-8');

    // Parsear CSV (separador: ;)
    const lines = csvContent.split('\n').filter((l: string) => l.trim() !== '');

    if (lines.length < 2) {
      console.log('⚠️ El CSV no tiene filas de datos (solo cabecera o vacío).');
      return [];
    }

    const headers = lines[0].split(';');
    const nameIdx = headers.indexOf('name');
    let phoneIdx = headers.indexOf('phoneNumber');
    if (phoneIdx === -1) {
      phoneIdx = headers.indexOf('phone');
    }

    if (nameIdx === -1 || phoneIdx === -1) {
      console.error(`❌ Columnas esperadas no encontradas. Headers: ${headers.join(', ')}`);
      throw new Error(`El reporte no tiene las columnas requeridas (name, phone o phoneNumber). Columnas encontradas: ${headers.join(', ')}`);
    }

    const contacts: { name: string; phoneNumber: string }[] = [];

    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].split(';');
      const name = row[nameIdx]?.replace(/^"|"$/g, '') || '';
      const phone = row[phoneIdx]?.replace(/^'/, '') || ''; // Quitar comilla simple que EspoCRM agrega

      if (name || phone) {
        contacts.push({ name, phoneNumber: phone });
      }
    }

    console.log(`   ✅ ${contacts.length} contactos extraídos del CSV`);
    return contacts;
  }

  /**
   * Envía el template a cada contacto, valida teléfonos y registra mensajes.
   */
  private async sendToContacts(
    contacts: { name: string; phoneNumber: string }[],
    template: EspoCRMWhatsappTemplate,
    attachmentUrl?: string,
  ): Promise<TemplateSendResult> {
    const result: TemplateSendResult = {
      totalContacts: contacts.length,
      sent: 0,
      failed: 0,
      errors: [],
    };

    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      console.log(`\n--- [${i + 1}/${contacts.length}] Procesando: ${contact.name} ---`);

      // Validar teléfono con phone-utils
      const phoneValidation = extractAndValidatePhone({
        phoneNumber: contact.phoneNumber,
      });

      if (!phoneValidation.isValid) {
        console.log(`   ⚠️ Teléfono inválido para "${contact.name}": ${phoneValidation.error}`);
        result.failed++;
        result.errors.push({
          contact: contact.name,
          phone: contact.phoneNumber,
          error: phoneValidation.error || 'Teléfono inválido',
        });
        continue;
      }

      const validPhone = phoneValidation.formattedNumber!;

      // Construir variables del template
      const contentVariables: Record<string, string> = {
        '1': template.contentMessageTemplate, // {{1}} = contenido del mensaje
      };

      // {{2}} = archivo adjunto SOLO si existe
      if (attachmentUrl) {
        contentVariables['2'] = attachmentUrl;
      }

      try {
        // Enviar template dinámico
        const twilioResponse = await sendDynamicTemplateMessage({
          phone: validPhone,
          contentSid: template.whatsappTemplateSID,
          contentVariables,
        });

        // Registrar mensaje en WhatsappMessage y vincular con WhatsappTemplate
        await this.logMessageInEspo(
          template,
          validPhone,
          contact.name,
          twilioResponse,
        );

        result.sent++;
        console.log(`   ✅ Enviado exitosamente a ${contact.name} (${validPhone})`);

        // PREVENCIÓN DE RATE-LIMIT / 11200:
        // Twilio intenta descargar el archivo (MediaUrl) inmediatamente tras llamar a su API.
        // Si mandamos N mensajes seguidos, Twilio saturará a Ngrok/EspoCRM con descargas paralelas 
        // y arrojará error 11200 o 21656. Damos 1.5s de respiro entre contactos.
        if (i < contacts.length - 1) {
          console.log(`   ⏱️ Pausando 1.5s antes del siguiente envío para evitar bloqueos...`);
          await new Promise(resolve => setTimeout(resolve, 1500));
        }

      } catch (error: any) {
        console.error(`   ❌ Error enviando a "${contact.name}": ${error.message}`);
        result.failed++;
        result.errors.push({
          contact: contact.name,
          phone: validPhone,
          error: error.message,
        });
      }
    }

    return result;
  }

  /**
   * Registra el mensaje enviado en WhatsappMessage y lo vincula con WhatsappTemplate.
   */
  private async logMessageInEspo(
    template: EspoCRMWhatsappTemplate,
    phone: string,
    contactName: string,
    twilioResponse: any,
  ): Promise<void> {
    console.log('   💾 Guardando mensaje en WhatsappMessage...');

    try {
      // Buscar conversación existente
      let conversationId: string | null = null;

      const conversations = await this.espoCRMClient.searchEntities('WhatsappConverstion', [
        {
          type: 'equals',
          attribute: 'name',
          value: phone,
        },
      ]);

      if (conversations.length > 0) {
        conversationId = conversations[0].id;
        console.log(`   ✅ Conversación existente: ${conversationId}`);
      } else {
        console.log(`   ℹ️ No hay conversación previa para ${phone}, se guarda el mensaje solo.`);
      }

      // Crear registro de WhatsappMessage con el contenido real
      const senderPhone = env.twilioWhatsappFrom.replace('whatsapp:', '');
      const messagePayload: any = {
        name: senderPhone,
        contact: senderPhone,
        status: 'Sent',
        type: 'Out',
        description: template.contentMessageTemplate, // Contenido real del mensaje enviado
        messageSid: twilioResponse.sid,
        isRead: false,
      };

      // Adjuntar archivo al mensaje de EspoCRM si existe
      if (template.archivoAdjuntoId) {
        messagePayload.archivoAdjuntoId = template.archivoAdjuntoId;
      }

      if (conversationId) {
        messagePayload.whatsappConverstionId = conversationId;
      }

      const createdMessage = await this.espoCRMClient.createEntity('WhatsappMessage', messagePayload);
      console.log(`   ✅ Mensaje guardado en WhatsappMessage (SID: ${twilioResponse.sid})`);

      // Actualizar conversación con último mensaje solo si existe la conversación
      if (conversationId) {
        // Guardamos un extracto en description, o 'Template enviado' para la vista de lista de conversaciones
        const textPreview = template.contentMessageTemplate 
          ? template.contentMessageTemplate.substring(0, 100) + '...' 
          : `Template enviado`;

        await this.espoCRMClient.updateEntity('WhatsappConverstion', conversationId, {
          description: textPreview,
          fechaHoraUltimoMensaje: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
      }

    } catch (error: any) {
      console.error('   ❌ Error guardando en WhatsappMessage (el mensaje sí se envió):', error.message);
      // No relanzamos el error porque el envío de Twilio fue exitoso
    }
  }
}
