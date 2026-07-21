"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.whatsappBulkJobManager = exports.WhatsappBulkJobManager = void 0;
const crypto_1 = require("crypto");
const whatsapp_all_contacts_service_1 = require("./whatsapp-all-contacts.service");
const COMPLETED_JOB_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * Cola ligera en memoria. Permite responder HTTP 202 inmediatamente mientras
 * el envio continua dentro del proceso Node y evita dos trabajos simultaneos
 * para el mismo WhatsappTemplate.
 */
class WhatsappBulkJobManager {
    constructor(runnerFactory = () => new whatsapp_all_contacts_service_1.WhatsappAllContactsService()) {
        this.runnerFactory = runnerFactory;
        this.jobs = new Map();
        this.activeJobsByTemplate = new Map();
    }
    enqueue(templateRecordId) {
        const activeJobId = this.activeJobsByTemplate.get(templateRecordId);
        if (activeJobId) {
            const activeJob = this.jobs.get(activeJobId);
            if (activeJob) {
                return { job: this.cloneJob(activeJob), reused: true };
            }
        }
        const job = {
            id: (0, crypto_1.randomUUID)(),
            templateRecordId,
            status: 'queued',
            createdAt: new Date().toISOString(),
            progress: (0, whatsapp_all_contacts_service_1.createInitialAllContactsProgress)(),
        };
        this.jobs.set(job.id, job);
        this.activeJobsByTemplate.set(templateRecordId, job.id);
        setImmediate(() => {
            void this.execute(job.id);
        });
        return { job: this.cloneJob(job), reused: false };
    }
    getJob(jobId) {
        const job = this.jobs.get(jobId);
        return job ? this.cloneJob(job) : undefined;
    }
    async execute(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) {
            return;
        }
        job.status = 'running';
        job.startedAt = new Date().toISOString();
        try {
            const runner = this.runnerFactory();
            job.progress = await runner.handleAllContactsSend(job.templateRecordId, progress => {
                job.progress = this.cloneProgress(progress);
            });
            job.status = 'completed';
        }
        catch (error) {
            job.status = 'failed';
            job.error = error.message || 'Error desconocido en el envio masivo';
            console.error(`❌ Trabajo masivo ${job.id} fallido:`, job.error);
        }
        finally {
            job.finishedAt = new Date().toISOString();
            this.activeJobsByTemplate.delete(job.templateRecordId);
            this.scheduleCleanup(job.id);
        }
    }
    scheduleCleanup(jobId) {
        const timer = setTimeout(() => {
            this.jobs.delete(jobId);
        }, COMPLETED_JOB_TTL_MS);
        timer.unref();
    }
    cloneJob(job) {
        return {
            ...job,
            progress: this.cloneProgress(job.progress),
        };
    }
    cloneProgress(progress) {
        return {
            ...progress,
            errors: progress.errors.map(error => ({ ...error })),
        };
    }
}
exports.WhatsappBulkJobManager = WhatsappBulkJobManager;
exports.whatsappBulkJobManager = new WhatsappBulkJobManager();
