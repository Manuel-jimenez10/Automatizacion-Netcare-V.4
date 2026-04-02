import 'dotenv/config';
import app from './app';
import { startQuoteFollowUpJob } from './jobs/quote-followup.job';
import { startInvoiceReminderJob } from './jobs/invoice-reminder.job';

const PORT = process.env.PORT || 3000;

// Este archivo es SOLO para ejecución local o VPS tradicional
// Passenger NO usa este archivo.
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  
  // Iniciar Cron Jobs
  startQuoteFollowUpJob();
  startInvoiceReminderJob();
});
