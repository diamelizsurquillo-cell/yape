package com.minegocio.yapesensor

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "pending_payments")
data class PendingPayment(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val remitente: String,
    val monto: Double,
    val timestamp: Long,
    val codigoSeguridad: String?,
    val banco: String = "YAPE"
)
