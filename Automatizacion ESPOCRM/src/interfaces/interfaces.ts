// Interfaces para las entidades de EspoCRM

export interface EspoCRMTask {
  id: string;
  name: string;
  status: string;
  parentType?: string;
  parentId?: string;
  description?: string;
  dateCompleted?: string;
}

export interface EspoCRMContact {
  id: string;
  name: string;
  phoneNumber?: string;
  phoneMobile?: string;
  phoneOffice?: string;
  firstName?: string;
  lastName?: string;
}

export interface WebhookPayload {
  taskId: string;
  event?: string;
  entityType?: string;
}

export interface EspoCRMQuote {
  id: string;
  name: string;
  status: string;
  datePresented?: string;
  accountId?: string;
  accountName?: string;
  followUpSentAt?: string; // Campo custom para marcar como notificada
  cotizacinPropuestaId?: string; // ID del archivo PDF adjunto
  cotizacinEnviadaPorWhatsapp?: string; // Fecha de último envío por WhatsApp
  createdAt: string; // Fecha de creación (Date Quoted)
}

export interface EspoCRMAccount {
  id: string;
  name: string;
  billingContactId?: string;
  billingContactName?: string;
  phoneNumber?: string;
  phoneMobile?: string;
  phoneOffice?: string;
  phone?: string;
}

// Tipo de utilidad para validar números de teléfono
export interface PhoneValidation {
  isValid: boolean;
  formattedNumber?: string;
  error?: string;
}
