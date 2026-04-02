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
  phone?: string;
  phoneNumberData?: Array<{ phoneNumber: string; type: string; primary: boolean }>;
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
  billingContactId?: string; // Nuevo campo para contacto de facturación
  billingContactName?: string;
  followUpSentAt?: string; // Campo custom para marcar como notificada
  cotizacinPropuestaId?: string; // ID del archivo PDF adjunto
  cotizacinEnviadaPorWhatsapp?: string; // Fecha de último envío por WhatsApp
  createdAt: string; // Fecha de creación (Date Quoted)
}

export interface EspoCRMInvoice {
  id: string;
  name: string;
  status: string;
  billingContactId?: string;
  billingContactName?: string;
  accountId?: string;
  accountName?: string;
  prefacturaAdjuntaId?: string; // ID del archivo PDF adjunto (campo File: prefacturaAdjunta)
  fechaLimiteDePago?: string; // Campo fecha para vencimiento
  recordatorio3DiasEnviado?: string; // Custom Date field for 3 days reminder
  avisoVencimientoEnviado?: string; // Custom Date field for overdue reminder
  createdAt: string;
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

export interface PhoneValidation {
  isValid: boolean;
  formattedNumber?: string;
  error?: string;
}

export interface WhatsappMessage {
  id?: string;
  name: string; // Phone number
  text: string;
  type: 'In' | 'Out';
  status: 'Delivered' | 'Read' | 'Queued' | 'Sent' | 'Error';
  whatsappConversationId?: string; // Legacy/Correct spelling
  whatsappConverstionId?: string; // Actual EspoCRM field with typo
  messageSid?: string; // Twilio Message SID
  description?: string; // Sometimes used for text
  contactId?: string; // Link to Contact entity
}

export interface WhatsappConverstion {
  id: string;
  name: string;
  fechaHoraUltimoMensaje?: string;
  description?: string; // Last message text often goes here in Espo
}

export interface EspoCRMWhatsappTemplate {
  id: string;
  name: string;
  whatsappTemplateSID: string;      // SID del template de Twilio
  whatsappTemplateName?: string;    // Nombre descriptivo del template
  contentMessageTemplate: string;   // Texto → variable {{1}}
  archivoAdjuntoId?: string;        // ID del archivo adjunto → variable {{2}} (condicional)
  reportsId?: string;               // ID del Report relacionado (link: reports, Many-to-One)
  reportsName?: string;             // Nombre del Report relacionado
}
