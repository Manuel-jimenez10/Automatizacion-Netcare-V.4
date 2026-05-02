import { EspoCRMClient } from './espocrm-api-client.service';
import { sendInvoiceConfirmedMessage, sendFacturaPresentedMessage, sendFacturaAdicionalMessage, sendFacturaXmlButtonMessage } from './twilio.service';
import { env } from '../config/env';
import { EspoCRMInvoice } from '../interfaces/interfaces';
import { extractAndValidatePhone } from '../utils/phone-utils';
import { xmlPendingStore } from './xml-pending-store';

export class InvoiceConfirmedService {
  private espoCRMClient: EspoCRMClient;

  constructor() {
    this.espoCRMClient = new EspoCRMClient();
  }

  /**
   * Maneja el evento de Prefactura Confirmada (Webhook)
   * 1. Obtiene la Invoice (Prefactura)
   * 2. Valida Contacto de Facturación y Teléfono
   * 3. Separa archivos PDF de XML en el campo Factura
   * 4. Envía Templates de WhatsApp (solo PDFs en templates)
   * 5. Si hay XML, envía Quick Reply "Solicitar mi XML" y guarda XML pendiente
   * 6. Registra el mensaje en EspoCRM
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
      const phoneValidation = extractAndValidatePhone(contact);

      if (!phoneValidation.isValid) {
        throw new Error(`Billing Contact "${contact.name}" no tiene un teléfono válido: ${phoneValidation.error}`);
      }

      console.log(`📞 Teléfono válido (desde Billing Contact): ${phoneValidation.formattedNumber}`);

      // 5. Obtener nombre del cliente
      const clientName = contact.name || contact.firstName || 'Cliente';
      console.log(`👤 Cliente: ${clientName}`);

      // 6. Manejo de archivos (Prefactura y Factura) — SEPARAR PDFs de XMLs
      const prefacturaPdfId = invoice.prefacturaAdjuntaId;
      const hasPrefactura = !!prefacturaPdfId;

      let facturaPdfIds: string[] = [];
      let facturaXmlIds: string[] = [];

      // Extraer archivos del campo múltiple "Factura" y separarlos por tipo
      if (invoice.facturaIds) {
        if (invoice.facturaNames) {
          for (const id of invoice.facturaIds) {
            const fileName = invoice.facturaNames[id] || '';
            const lowerName = fileName.toLowerCase();
            if (lowerName.endsWith('.pdf')) {
              facturaPdfIds.push(id);
            } else if (lowerName.endsWith('.xml')) {
              facturaXmlIds.push(id);
            }
          }
        } else {
          // Fallback: si no hay nombres, asumir que todos son PDFs
          facturaPdfIds = [...invoice.facturaIds];
        }
      }

      const hasFacturaPdf = facturaPdfIds.length > 0;
      const hasXml = facturaXmlIds.length > 0;

      console.log(`📎 Resumen de archivos detectados:`);
      console.log(`   - Prefactura: ${hasPrefactura ? `Sí (ID: ${prefacturaPdfId})` : 'No'}`);
      console.log(`   - Factura PDFs: ${facturaPdfIds.length} archivo(s) ${facturaPdfIds.length > 0 ? `(IDs: ${facturaPdfIds.join(', ')})` : ''}`);
      console.log(`   - Factura XMLs: ${facturaXmlIds.length} archivo(s) ${facturaXmlIds.length > 0 ? `(IDs: ${facturaXmlIds.join(', ')})` : ''}`);

      if (!hasPrefactura && !hasFacturaPdf) {
        throw new Error(`La Prefactura "${invoice.name}" no tiene ningún archivo PDF adjunto (ni prefactura ni factura).`);
      }

      // Generar URLs Públicas
      const prefacturaUrl = hasPrefactura ? `${env.publicUrl}/api/files/${prefacturaPdfId}` : undefined;
      const facturaPdfUrls = facturaPdfIds.map(id => `${env.publicUrl}/api/files/${id}`);
      const facturaXmlUrls = facturaXmlIds.map(id => `${env.publicUrl}/api/files/${id}`);

      // 7. Si hay XMLs, guardarlos en el store pendiente para cuando el cliente presione el botón
      if (hasXml) {
        xmlPendingStore.set(phoneValidation.formattedNumber!, facturaXmlUrls, invoice.name);
        console.log(`📦 XML(s) guardado(s) en store pendiente para entrega bajo demanda`);
      }

      // 8. Lógica de Árbol (T1, T2, T3) y Envío de WhatsApp — SOLO PDFs en templates
      let twilioResponse: any;

      if (hasPrefactura && hasFacturaPdf) {
         // CASO T1: Prefactura + Factura(s) PDF
         console.log('📱 Enviando T1: Template Prefactura + Template(s) Factura PDF...');
         
         // 1er Envío: Prefactura
         twilioResponse = await sendInvoiceConfirmedMessage({
           phone: phoneValidation.formattedNumber!,
           clientName: clientName,
           invoiceName: invoice.name,
           pdfUrl: prefacturaUrl,
         });

         // Envíos de Facturas (solo PDFs)
         for (const fUrl of facturaPdfUrls) {
           await new Promise(resolve => setTimeout(resolve, 1500));
           await sendFacturaAdicionalMessage({
             phone: phoneValidation.formattedNumber!,
             pdfUrl: fUrl,
           });
         }

         // Si hay XML → enviar Quick Reply "Solicitar mi XML" (delay largo para que los PDFs lleguen primero)
         if (hasXml) {
           await new Promise(resolve => setTimeout(resolve, 3000));
           console.log('📱 Enviando Quick Reply "Solicitar mi XML" (después de PDFs)...');
           await sendFacturaXmlButtonMessage({
             phone: phoneValidation.formattedNumber!,
             invoiceName: invoice.name,
           });
         }

      } else if (hasPrefactura && !hasFacturaPdf) {
         // CASO T3: Solo Prefactura (sin factura)
         console.log('📱 Enviando T3: Solo Template Prefactura Normal...');
         twilioResponse = await sendInvoiceConfirmedMessage({
           phone: phoneValidation.formattedNumber!,
           clientName: clientName,
           invoiceName: invoice.name,
           pdfUrl: prefacturaUrl,
         });

      } else if (!hasPrefactura && hasFacturaPdf) {
         // CASO T2: Solo Factura(s) PDF
         console.log('📱 Enviando T2: Solo Template Factura Sola...');
         
         // El primer PDF se manda con sendFacturaPresentedMessage
         twilioResponse = await sendFacturaPresentedMessage({
           phone: phoneValidation.formattedNumber!,
           clientName: clientName,
           invoiceName: invoice.name,
           pdfUrl: facturaPdfUrls[0],
         });

         // Los siguientes PDFs se mandan como Factura Adicional
         for (let i = 1; i < facturaPdfUrls.length; i++) {
           await new Promise(resolve => setTimeout(resolve, 1500));
           await sendFacturaAdicionalMessage({
             phone: phoneValidation.formattedNumber!,
             pdfUrl: facturaPdfUrls[i],
           });
         }

         // Si hay XML → enviar Quick Reply "Solicitar mi XML" (delay largo para que los PDFs lleguen primero)
         if (hasXml) {
           await new Promise(resolve => setTimeout(resolve, 3000));
           console.log('📱 Enviando Quick Reply "Solicitar mi XML" (después de PDFs)...');
           await sendFacturaXmlButtonMessage({
             phone: phoneValidation.formattedNumber!,
             invoiceName: invoice.name,
           });
         }
      }

      // 9. Guardar mensaje en WhatsappMessage (EspoCRM)
      await this.logMessageInEspo(invoice, phoneValidation.formattedNumber!, clientName, twilioResponse);

      console.log('\n✅ ============================================');
      console.log('✅ Proceso de Prefactura Confirmada completado exitosamente');
      if (hasXml) {
        console.log('✅ XML pendiente registrado — esperando que el cliente presione "Solicitar mi XML"');
      }
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

}
