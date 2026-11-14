package com.minegocio.yapesensor

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface PendingPaymentDao {
    @Query("SELECT * FROM pending_payments ORDER BY timestamp ASC")
    suspend fun getAllPending(): List<PendingPayment>

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertIgnore(payment: PendingPayment): Long

    @Query("DELETE FROM pending_payments WHERE eventUid = :eventUid")
    suspend fun deleteByEventUid(eventUid: String)

    @Delete
    suspend fun delete(payment: PendingPayment)
}
