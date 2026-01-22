// Interfaces para Twilio Status Callback Webhooks

export interface TwilioStatusCallbackPayload {
  MessageSid: string;           // ID único del mensaje
  MessageStatus: string;        // queued, sent, delivered, read, failed, undelivered
  To: string;                   // whatsapp:+number
  From: string;                 // whatsapp:+number
  AccountSid: string;           // Account SID de Twilio
  
  // Campos opcionales
  SmsStatus?: string;           // Alias de MessageStatus
  ErrorCode?: string;           // Código de error si falló
  ErrorMessage?: string;        // Mensaje de error
  
  // Campos de Content API
  ContentSid?: string;          // Si se usó template
  NumMedia?: string;            // Número de archivos media
  NumSegments?: string;         // Número de segmentos SMS
  
  // Timestamps
  DateCreated?: string;
  DateUpdated?: string;
  DateSent?: string;
}

export interface TwilioIncomingMessagePayload {
  From: string;                 // whatsapp:+number
  To: string;                   // whatsapp:+number
  Body: string;                 // Texto del mensaje
  MessageSid: string;           // ID único
  AccountSid: string;
  
  // Campos opcionales
  NumMedia?: string;
  MediaUrl0?: string;           // URL del primer archivo media
  MediaContentType0?: string;   // Tipo MIME del primer media
  ProfileName?: string;         // Nombre de perfil del remitente
  
  // Ubicación (si el mensaje contiene ubicación)
  Latitude?: string;
  Longitude?: string;
}
