import { EspoCRMClient } from './espocrm-api-client.service';
import { sendTaskCompletedMessage } from './twilio.service';
import { PhoneValidation } from '../interfaces/interfaces';

export class TaskCompletionService {
  private espoCRMClient: EspoCRMClient;

  constructor() {
    this.espoCRMClient = new EspoCRMClient();
  }

  /**
   * Maneja el evento de completación de una Task
   * Orquesta todo el flujo: Task → Contact → WhatsApp
   */
  async handleTaskCompletion(taskId: string): Promise<void> {
    console.log('\n🚀 ============================================');
    console.log(`🚀 Iniciando proceso de Task completada: ${taskId}`);
    console.log('🚀 ============================================\n');

    try {
      // 1. Obtener la Task desde EspoCRM
      const task = await this.espoCRMClient.getTask(taskId);
      
      // 2. Validar que la Task esté completada
      if (task.status !== 'Completed') {
        console.log(`⚠️  Task no está completada. Estado actual: ${task.status}`);
        throw new Error(`La Task no está en estado Completed (estado actual: ${task.status})`);
      }

      console.log(`✅ Task "${task.name}" confirmada como Completed`);

      // 3. Validar que existe una relación padre
      if (!task.parentType || !task.parentId) {
        console.log('❌ La Task no tiene una relación padre (parentType/parentId)');
        throw new Error('La Task no tiene una relación padre asociada');
      }

      console.log(`🔗 Relación encontrada: ${task.parentType} (ID: ${task.parentId})`);

      // 4. Obtener la entidad padre (normalmente un Contact)
      const parentEntity = await this.espoCRMClient.getEntity(
        task.parentType,
        task.parentId
      );

      // 5. Extraer el número de teléfono
      const phoneValidation = this.extractAndValidatePhone(parentEntity);

      if (!phoneValidation.isValid) {
        console.log(`❌ ${phoneValidation.error}`);
        throw new Error(phoneValidation.error);
      }

      console.log(`📞 Teléfono válido encontrado: ${phoneValidation.formattedNumber}`);

      // 6. Obtener el nombre del cliente
      const clientName = this.getClientName(parentEntity);
      console.log(`👤 Nombre del cliente: ${clientName}`);

      // 7. Enviar mensaje de WhatsApp
      await sendTaskCompletedMessage({
        phone: phoneValidation.formattedNumber!,
        clientName: clientName,
        taskName: task.name,
      });

      console.log('\n✅ ============================================');
      console.log('✅ Proceso completado exitosamente');
      console.log('✅ ============================================\n');

    } catch (error: any) {
      console.log('\n❌ ============================================');
      console.log(`❌ Error en el proceso: ${error.message}`);
      console.log('❌ ============================================\n');
      throw error;
    }
  }

  /**
   * Extrae y valida el número de teléfono de una entidad
   * Busca en múltiples campos posibles: phoneNumber, phoneMobile, phoneOffice, phone
   */
  private extractAndValidatePhone(entity: any): PhoneValidation {
    console.log('🔍 Buscando número de teléfono en la entidad...');

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
        error: `No se encontró número de teléfono en la entidad. Campos revisados: ${phoneFields.join(', ')}`,
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
    // Si no empieza con +, asumimos código de país por defecto
    if (!cleanedPhone.startsWith('+')) {
      // Si empieza con número, agregar + (asume que ya tiene código de país)
      // Ej: 521234567890 → +521234567890
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
   * Obtiene el nombre del cliente de la entidad
   * Intenta diferentes campos: name, firstName + lastName, etc.
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
