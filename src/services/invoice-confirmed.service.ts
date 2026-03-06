import { EspoCRMClient } from './espocrm-api-client.service';
import { sendInvoiceConfirmedMessage } from './twilio.service';
import { env } from '../config/env';
import { EspoCRMInvoice, PhoneValidation } from '../interfaces/interfaces';

export class InvoiceConfirmedService {
  private espoCRMClient: EspoCRMClient;

  constructor() {
    this.espoCRMClient = new EspoCRMClient();
  }

  /**
   * Maneja el evento de Prefactura Confirmada (Webhook)
   * 1. Obtiene la Invoice (Prefactura)
   * 2. Valida Contacto de Facturación y Teléfono
   * 3. Obtiene URL del PDF
   * 4. Envía WhatsApp con Template
   * 5. Registra el mensaje en EspoCRM
   */
  async handleInvoiceConfirmed(invoiceId: string): Promise<void> {
    console.log('\n🚀 ============================================');
    console.log(`🚀 Iniciando proceso de Prefactura Confirmada: ${invoiceId}`);
    console.log('🚀 ============================================\n');

    try {
      // 1. Obtener la Invoice desde EspoCRM
      const invoice = await this.espoCRMClient.getEntity('Invoice', invoiceId) as EspoCRMInvoice;
      
      console.log(`📋 Procesando Prefactura: "${invoice.name}" (ID: ${invoice.id})`);
      console.log(`   Estado: ${invoice.status}`);

      // 2. Validar que tiene Contacto de Facturación (Billing Contact)
      if (!invoice.billingContactId) {
        console.log(`⚠️ Advertencia: Prefactura "${invoice.name}" (ID: ${invoice.id}) no tiene Billing Contact asociado.`);
        throw new Error(`La Prefactura "${invoice.name}" no tiene un Contacto de Facturación (Billing Contact) asignado.`);
      }

      console.log(`🔗 Billing Contact ID: ${invoice.billingContactId}`);

      // 3. Obtener Contacto
      const contact = await this.espoCRMClient.getContact(invoice.billingContactId);

      // 4. Extraer y validar teléfono desde el CONTACTO
      const phoneValidation = this.extractAndValidatePhone(contact);

      if (!phoneValidation.isValid) {
        throw new Error(`Billing Contact "${contact.name}" no tiene un teléfono válido: ${phoneValidation.error}`);
      }

      console.log(`📞 Teléfono válido (desde Billing Contact): ${phoneValidation.formattedNumber}`);

      // 5. Obtener nombre del cliente
      const clientName = contact.name || contact.firstName || 'Cliente';
      console.log(`👤 Cliente: ${clientName}`);

      // 6. Manejo del PDF (campo File: prefacturaAdjunta → prefacturaAdjuntaId)
      const pdfFileId = invoice.prefacturaAdjuntaId;
      
      if (!pdfFileId) {
        throw new Error(`La Prefactura "${invoice.name}" no tiene PDF adjunto (campo prefacturaAdjunta vacío).`);
      }

      const pdfUrl = `${env.publicUrl}/api/files/${pdfFileId}`;
      console.log(`📎 PDF adjunto detectado. ID: ${pdfFileId}`);
      console.log(`📎 URL Pública (Proxy): ${pdfUrl}`);

      // 7. Enviar mensaje de WhatsApp
      console.log('📱 Enviando mensaje de prefactura confirmada...');
      const twilioResponse = await sendInvoiceConfirmedMessage({
        phone: phoneValidation.formattedNumber!,
        clientName: clientName,
        invoiceName: invoice.name,
        pdfUrl: pdfUrl,
      });

      // 8. Guardar mensaje en WhatsappMessage (EspoCRM)
      await this.logMessageInEspo(invoice, phoneValidation.formattedNumber!, clientName, twilioResponse);

      console.log('\n✅ ============================================');
      console.log('✅ Proceso de Prefactura Confirmada completado exitosamente');
      console.log('✅ ============================================\n');

    } catch (error: any) {
      console.log('\n❌ ============================================');
      console.log(`❌ Error crítico en el proceso: ${error.message}`);
      console.log('❌ ============================================\n');
      throw error;
    }
  }

  /**
   * Registra el mensaje enviado en las entidades de EspoCRM (WhatsappMessage, WhatsappConverstion)
   */
  private async logMessageInEspo(
    invoice: EspoCRMInvoice, 
    phone: string, 
    clientName: string, 
    twilioResponse: any
  ): Promise<void> {
    console.log('💾 Guardando mensaje en WhatsappMessage...');
    try {
      // Buscar o crear conversación
      let conversationId: string = '';
      
      const conversations = await this.espoCRMClient.searchEntities('WhatsappConverstion', [
        {
          type: 'equals',
          attribute: 'name',
          value: phone
        }
      ]);

      if (conversations.length > 0) {
        conversationId = conversations[0].id;
        console.log(`✅ Conversación existente encontrada: ${conversationId}`);
      } else {
        console.log(`✨ Creando nueva conversación para ${phone}`);
        const conversationPayload: any = {
          name: phone,
          description: `Conversación iniciada por Prefactura Confirmada`
        };
        
        if (invoice.billingContactName) {
           conversationPayload.contact = invoice.billingContactName;
           if (invoice.billingContactId) {
             conversationPayload.contactId = invoice.billingContactId;
           }
        }
        
        const newConv = await this.espoCRMClient.createEntity('WhatsappConverstion', conversationPayload);
        conversationId = newConv.id;
      }

      // Crear registro de mensaje
      const senderPhone = env.twilioWhatsappFrom.replace('whatsapp:', '');
      const messagePayload: any = {
        name: senderPhone,
        contact: senderPhone,
        status: 'Sent', 
        type: 'Out',
        description: `Prefactura Confirmada: ${invoice.name}`,
        whatsappConverstionId: conversationId,
        messageSid: twilioResponse.sid,
        isRead: false
      };

      // Vincular con Contacto
      if (invoice.billingContactId) {
        messagePayload.contactId = invoice.billingContactId;
      }

      await this.espoCRMClient.createEntity('WhatsappMessage', messagePayload);

      console.log(`✅ Mensaje guardado en WhatsappMessage con SID: ${twilioResponse.sid}`);

      // Actualizar conversación con último mensaje
      await this.espoCRMClient.updateEntity('WhatsappConverstion', conversationId, {
        description: `Prefactura Confirmada: ${invoice.name}`,
        fechaHoraUltimoMensaje: new Date().toISOString().slice(0, 19).replace('T', ' '),
      });

    } catch (error: any) {
      console.error('❌ Error guardando mensaje en WhatsappMessage (el mensaje sí se envió):', error.message);
      // No relanzamos el error porque el envío de Twilio fue exitoso
    }
  }

  /**
   * Extrae y valida el número de teléfono (Reutilizado)
   */
  private extractAndValidatePhone(entity: any): PhoneValidation {
    console.log('🔍 Buscando número de teléfono en el contacto...');

    const phoneFields = ['phoneNumber', 'phoneMobile', 'phoneOffice', 'phone'];
    let phone: string | undefined;

    for (const field of phoneFields) {
      if (entity[field]) {
        phone = entity[field];
        console.log(`   ✓ Teléfono encontrado en campo: ${field}`);
        break;
      }
    }

    if (!phone) {
      return {
        isValid: false,
        error: `No se encontró número de teléfono. Campos revisados: ${phoneFields.join(', ')}`,
      };
    }

    let cleanedPhone = phone.replace(/[\s\-\(\)]/g, '');

    if (!cleanedPhone) {
      return { isValid: false, error: 'El número de teléfono está vacío después de limpiarlo' };
    }

    if (!cleanedPhone.startsWith('+')) {
      cleanedPhone = `+${cleanedPhone}`;
    }

    const digitsOnly = cleanedPhone.replace(/\D/g, '');
    if (digitsOnly.length < 10) {
      return {
        isValid: false,
        error: `El número de teléfono es muy corto: ${cleanedPhone} (solo ${digitsOnly.length} dígitos)`,
      };
    }

    console.log(`   ✓ Número limpiado y validado: ${cleanedPhone}`);

    return {
      isValid: true,
      formattedNumber: cleanedPhone,
    };
  }
}
