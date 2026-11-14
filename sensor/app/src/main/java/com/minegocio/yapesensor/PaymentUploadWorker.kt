package com.minegocio.yapesensor

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

class PaymentUploadWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    private val db = PaymentDatabase.getDatabase(appContext)
    private val repository = PaymentRepository(appContext)

    override suspend fun doWork(): Result {
        val pendingPayments = db.pendingPaymentDao().getAllPending()
        if (pendingPayments.isEmpty()) {
            return Result.success()
        }

        var hasFailure = false
        for (payment in pendingPayments) {
            val ok = repository.uploadSinglePayment(payment)
            if (ok) {
                db.pendingPaymentDao().delete(payment)
            } else {
                hasFailure = true
            }
        }

        return if (hasFailure) Result.retry() else Result.success()
    }
}
