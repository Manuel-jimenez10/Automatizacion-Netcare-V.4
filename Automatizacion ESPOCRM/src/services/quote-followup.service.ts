import { EspoCRMClient } from './espocrm-api-client.service';
import { sendQuoteFollowUpMessage } from './twilio.service';
import { env } from '../config/env';
import { EspoCRMQuote, PhoneValidation } from '../interfaces/interfaces';

export class QuoteFollowUpService {
  private espoCRMClient: EspoCRMClient;

  constructor() {
    this.espoCRMClient = new EspoCRMClient();
  }

  /**
   * Proceso principal: Busca y procesa Quotes que necesitan seguimiento
   * - Status: 'Presented'
   * - Fecha de presentación: >= 7 días atrás
   * - No notificadas previamente (followUpSentAt = null)
   */
  async processQuoteFollowUps(): Promise<void> {
    console.log('\n🚀 ============================================');
    console.log('🚀 Iniciando proceso de seguimiento de Quotes');
    console.log('🚀 ============================================\n');

    try {
      console.log(`📅 Buscando todas las Quotes en estado 'Presented' para verificar seguimiento...`);

      // 2. Construir filtros para la búsqueda
      const whereFilters = [
        {
          type: 'and',
          value: [
            {
              type: 'equals',
              attribute: 'status',
              value: 'Presented',
            },
            // {
            //   type: 'before',
            //   attribute: 'datePresented',
            //   value: dateLimitStr,
            // },
            // {
            //   type: 'isNull',
            //   attribute: 'followUpSentAt',
            // },
          ],
        },
      ];

      // 3. Buscar Quotes que cumplen los criterios
      const quotes = await this.espoCRMClient.searchEntities('Quote', whereFilters);

      if (quotes.length === 0) {
        console.log('ℹ️  No se encontraron Quotes que necesiten seguimiento');
        console.log('\n✅ ============================================');
        console.log('✅ Proceso completado (0 Quotes procesadas)');
        console.log('✅ ============================================\n');
        return;
      }

      console.log(`\n📊 Se encontraron ${quotes.length} Quote(s) para procesar\n`);

      // 4. Procesar cada Quote individualmente
      let successCount = 0;
      let errorCount = 0;

      for (const quote of quotes) {
        try {
          await this.processQuote(quote);
          successCount++;
        } catch (error: any) {
          console.error(`❌ Error procesando Quote ${quote.id}:`, error.message);
          errorCount++;
          // Continuar con la siguiente Quote (no detener todo el proceso)
        }
      }

      // 5. Resumen final
      console.log('\n📊 ============================================');
      console.log('📊 RESUMEN DEL PROCESO');
      console.log('📊 ============================================');
      console.log(`   Total Quotes encontradas: ${quotes.length}`);
      console.log(`   ✅ Procesadas exitosamente: ${successCount}`);
      console.log(`   ❌ Con errores: ${errorCount}`);
      console.log('📊 ============================================\n');

    } catch (error: any) {
      console.log('\n❌ ============================================');
      console.log(`❌ Error crítico en el proceso: ${error.message}`);
      console.log('❌ ============================================\n');
      throw error;
    }
  }

  /**
   * Procesa una Quote individual:
   * 1. Obtiene Account asociado
   * 2. Obtiene Billing Contact del Account
   * 3. Extrae y valida teléfono
   * 4. Envía mensaje de WhatsApp
   * 5. Marca Quote como notificada
   */
  private async processQuote(quote: EspoCRMQuote): Promise<void> {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📋 Procesando Quote: "${quote.name}" (ID: ${quote.id})`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // 1. Validar que tiene Account asociado
    if (!quote.accountId) {
      throw new Error('Quote no tiene Account asociado (accountId faltante)');
    }

    console.log(`🔗 Account ID: ${quote.accountId}`);

    // 2. Obtener Account
    const account = await this.espoCRMClient.getAccount(quote.accountId);

    // 3. Extraer y validar teléfono desde la CUENTA (ACCOUNT)
    // El usuario especificó que el teléfono debe venir del campo "Phone" de la Account
    const phoneValidation = this.extractAndValidatePhone(account);

    if (!phoneValidation.isValid) {
      throw new Error(`Account "${account.name}" no tiene un teléfono válido: ${phoneValidation.error}`);
    }

    console.log(`📞 Teléfono válido (desde Account): ${phoneValidation.formattedNumber}`);

    // 4. Obtener nombre del cliente
    const clientName = account.name;
    console.log(`👤 Cliente final: ${clientName}`);

    // --- LOGICA DE FECHAS (NUEVA) ---
    const datePresentedStr = quote.datePresented;
    const dateQuotedStr = quote.createdAt; 
    const lastWhatsappSentStr = quote.cotizacinEnviadaPorWhatsapp; // Campo custom corregido
    
    let referenceDate: Date;
    let referenceLabel: string;

    // 1. Determinar fecha base (Prioridad: WhatsApp enviado > Date Presented > Date Quoted)
    if (lastWhatsappSentStr) {
      referenceDate = new Date(lastWhatsappSentStr);
      referenceLabel = 'Último WhatsApp Enviado';
    } else if (datePresentedStr) {
      referenceDate = new Date(datePresentedStr);
      referenceLabel = 'Fecha de Presentación';
    } else {
      referenceDate = new Date(dateQuotedStr);
      referenceLabel = 'Fecha de Creación (Date Quoted)';
    }

    // Calcular días pasados
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - referenceDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

    console.log(`📅 Referencia: ${referenceLabel} (${referenceDate.toISOString().split('T')[0]})`);
    console.log(`⏳ Días pasados: ${diffDays} (Requerido: >= 7)`);

    if (diffDays < 7) {
      console.log('⏳ Aún no han pasado 7 días. Saltando.');
      return;
    }
    // ---------------------------------

    // --- MANEJO DEL PDF ---
    let pdfUrl: string | undefined;
    const pdfFileId = quote.cotizacinPropuestaId; // Campo corregido
    
    if (pdfFileId) {
       // Construir URL pública para el PDF (Proxy)
       // Formato: <PUBLIC_URL>/api/files/<FILE_ID>
       pdfUrl = `${env.publicUrl}/api/files/${pdfFileId}`;
       console.log(`📎 PDF adjunto detectado. ID: ${pdfFileId}`);
       console.log(`📎 URL Pública: ${pdfUrl}`);
    } else {
       console.log('⚠️ No hay cotización adjunta (campo cotizacinPropuestaId vacío). Se enviará sin PDF.');
    }
    // ----------------------

    // --- SEGURIDAD: MODO DE PRUEBA ---
    if (env.testPhoneNumber) {
      const safeNumber = env.testPhoneNumber.replace(/[\s\-\(\)]/g, '');
      const currentNumber = phoneValidation.formattedNumber!;
      
      const safe = safeNumber.startsWith('+') ? safeNumber : `+${safeNumber}`;
      const current = currentNumber.startsWith('+') ? currentNumber : `+${currentNumber}`;

      if (safe !== current) {
        console.log(`🛡️ [MODO SEGURO] Saltando envío REAL. El número ${current} no coincide con el número de prueba ${safe}`);
        // Aún así podríamos actualizar la fecha si fuera real, pero en test mode mejor no tocar nada o solo loggear
        return;
      }
      console.log('🛡️ [MODO SEGURO] Número autorizado. Procediendo con el envío.');
    }
    // ---------------------------------

    // 7. Enviar mensaje de WhatsApp
    console.log('📱 Enviando mensaje de seguimiento...');
    await sendQuoteFollowUpMessage({
      phone: phoneValidation.formattedNumber!,
      clientName: clientName,
      quoteName: quote.name,
      pdfUrl: pdfUrl,
    });

    // 8. Actualizar fecha de último envío
    const today = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
    console.log(`📝 Actualizando 'cotizacinEnviadaPorWhatsapp' a: ${today}`);
    
    await this.espoCRMClient.updateEntity('Quote', quote.id, {
      cotizacinEnviadaPorWhatsapp: today,
    });

    console.log(`✅ Quote "${quote.name}" procesada exitosamente`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }

  /**
   * Extrae y valida el número de teléfono de un contacto
   * Reutiliza la misma lógica del servicio de Tasks
   */
  private extractAndValidatePhone(entity: any): PhoneValidation {
    console.log('🔍 Buscando número de teléfono en el contacto...');

    // Posibles campos donde puede estar el teléfono
    const phoneFields = ['phoneNumber', 'phoneMobile', 'phoneOffice', 'phone'];
    
    let phone: string | undefined;
    let fieldFound: string | undefined;

    // Buscar el primer campo con un valor
    for (const field of phoneFields) {
      if (entity[field]) {
        phone = entity[field];
        fieldFound = field;
        console.log(`   ✓ Teléfono encontrado en campo: ${field}`);
        break;
      }
    }

    // Validar que se encontró un teléfono
    if (!phone) {
      return {
        isValid: false,
        error: `No se encontró número de teléfono. Campos revisados: ${phoneFields.join(', ')}`,
      };
    }

    // Limpiar el número (quitar espacios, guiones, paréntesis)
    let cleanedPhone = phone.replace(/[\s\-\(\)]/g, '');

    // Validar que no esté vacío después de limpiar
    if (!cleanedPhone) {
      return {
        isValid: false,
        error: 'El número de teléfono está vacío después de limpiarlo',
      };
    }

    // Asegurar que tenga código de país (+)
    if (!cleanedPhone.startsWith('+')) {
      cleanedPhone = `+${cleanedPhone}`;
    }

    // Validar longitud mínima (al menos 10 dígitos sin contar el +)
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

  /**
   * Obtiene el nombre del cliente
   * Reutiliza la misma lógica del servicio de Tasks
   */
  private getClientName(entity: any): string {
    // Si tiene campo "name", usarlo directamente
    if (entity.name) {
      return entity.name;
    }

    // Si tiene firstName y lastName, combinarlos
    if (entity.firstName || entity.lastName) {
      const firstName = entity.firstName || '';
      const lastName = entity.lastName || '';
      return `${firstName} ${lastName}`.trim();
    }

    // Fallback: usar el ID de la entidad
    return entity.id || 'Cliente';
  }
}
