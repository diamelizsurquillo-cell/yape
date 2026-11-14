package com.minegocio.yapesensor

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "pending_payments",
    indices = [Index(value = ["eventUid"], unique = true)]
)
data class PendingPayment(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val eventUid: String,
    val remitente: String,
    val monto: Double,
    val timestamp: Long,
    val codigoSeguridad: String?,
    val banco: String = "YAPE"
)
