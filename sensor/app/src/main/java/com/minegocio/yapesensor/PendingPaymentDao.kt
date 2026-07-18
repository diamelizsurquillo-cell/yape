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

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(payment: PendingPayment)

    @Delete
    suspend fun delete(payment: PendingPayment)
}
