import { randomUUID } from 'crypto';
import {
  AllContactsSendProgress,
  createInitialAllContactsProgress,
  WhatsappAllContactsService,
} from './whatsapp-all-contacts.service';

const COMPLETED_JOB_TTL_MS = 24 * 60 * 60 * 1000;

export type WhatsappBulkJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed';

export interface WhatsappBulkJob {
  id: string;
  templateRecordId: string;
  status: WhatsappBulkJobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  progress: AllContactsSendProgress;
  error?: string;
}

export interface EnqueueWhatsappBulkJobResult {
  job: WhatsappBulkJob;
  reused: boolean;
}

interface AllContactsJobRunner {
  handleAllContactsSend(
    templateRecordId: string,
    onProgress?: (progress: AllContactsSendProgress) => void,
  ): Promise<AllContactsSendProgress>;
}

type AllContactsJobRunnerFactory = () => AllContactsJobRunner;

/**
 * Cola ligera en memoria. Permite responder HTTP 202 inmediatamente mientras
 * el envio continua dentro del proceso Node y evita dos trabajos simultaneos
 * para el mismo WhatsappTemplate.
 */
export class WhatsappBulkJobManager {
  private readonly jobs = new Map<string, WhatsappBulkJob>();
  private readonly activeJobsByTemplate = new Map<string, string>();

  constructor(
    private readonly runnerFactory: AllContactsJobRunnerFactory =
      () => new WhatsappAllContactsService(),
  ) {}

  enqueue(templateRecordId: string): EnqueueWhatsappBulkJobResult {
    const activeJobId = this.activeJobsByTemplate.get(templateRecordId);
    if (activeJobId) {
      const activeJob = this.jobs.get(activeJobId);
      if (activeJob) {
        return { job: this.cloneJob(activeJob), reused: true };
      }
    }

    const job: WhatsappBulkJob = {
      id: randomUUID(),
      templateRecordId,
      status: 'queued',
      createdAt: new Date().toISOString(),
      progress: createInitialAllContactsProgress(),
    };

    this.jobs.set(job.id, job);
    this.activeJobsByTemplate.set(templateRecordId, job.id);

    setImmediate(() => {
      void this.execute(job.id);
    });

    return { job: this.cloneJob(job), reused: false };
  }

  getJob(jobId: string): WhatsappBulkJob | undefined {
    const job = this.jobs.get(jobId);
    return job ? this.cloneJob(job) : undefined;
  }

  private async execute(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }

    job.status = 'running';
    job.startedAt = new Date().toISOString();

    try {
      const runner = this.runnerFactory();
      job.progress = await runner.handleAllContactsSend(
        job.templateRecordId,
        progress => {
          job.progress = this.cloneProgress(progress);
        },
      );
      job.status = 'completed';
    } catch (error: any) {
      job.status = 'failed';
      job.error = error.message || 'Error desconocido en el envio masivo';
      console.error(`❌ Trabajo masivo ${job.id} fallido:`, job.error);
    } finally {
      job.finishedAt = new Date().toISOString();
      this.activeJobsByTemplate.delete(job.templateRecordId);
      this.scheduleCleanup(job.id);
    }
  }

  private scheduleCleanup(jobId: string): void {
    const timer = setTimeout(() => {
      this.jobs.delete(jobId);
    }, COMPLETED_JOB_TTL_MS);

    timer.unref();
  }

  private cloneJob(job: WhatsappBulkJob): WhatsappBulkJob {
    return {
      ...job,
      progress: this.cloneProgress(job.progress),
    };
  }

  private cloneProgress(progress: AllContactsSendProgress): AllContactsSendProgress {
    return {
      ...progress,
      errors: progress.errors.map(error => ({ ...error })),
    };
  }
}

export const whatsappBulkJobManager = new WhatsappBulkJobManager();
