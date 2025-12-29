import app from './app';
import './config/env';
import { startQuoteFollowUpJob } from './jobs/quote-followup.job';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  
  // Iniciar cron job de seguimiento de Quotes
  startQuoteFollowUpJob();
});
