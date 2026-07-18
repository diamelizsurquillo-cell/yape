package com.minegocio.yapesensor

import java.util.regex.Pattern

object YapeNotificationParser {
    // Expresión regular insensible a mayúsculas/minúsculas para capturar monto y remitente.
    // Ejemplos soportados:
    // - "Te yapeó S/ 10.00 de Juan Perez"
    // - "Te yapeó S/10.00 de Juan Perez"
    // - "¡Yape! Te yapeó S/ 15 de Maria"
    // - "Te yapeó S/ 1,200.00 de Carlos"
    // - "Te han yapeado S/ 50.00 de Pedro."
    // Patrón A (Tradicional): "Te yapeó S/ 10.00 de Juan Perez" o "Te han yapeado S/ 50.00 de Pedro."
    private val patternA = Pattern.compile(
        "(?i)(?:te yapeó|te yapeo|te yapearon|te han yapeado)\\s+s/?\\s*([0-9.,]+)\\s+de\\s+(.+)"
    )

    // Patrón B (Nuevo formato): "Lidia Cas* te envió un pago por S/ 1. El cód. de seguridad es: 296"
    private val patternB = Pattern.compile(
        "(?i)(.+?)\\s+te\\s+envió\\s+un\\s+pago\\s+por\\s+s/?\\s*([0-9.,]+)(?:\\.\\s+el\\s+cód\\.?\\s+de\\s+seguridad\\s+es:\\s*(\\d+))?"
    )

    data class ParsedPayment(
        val remitente: String,
        val monto: Double,
        val timestamp: Long,
        val codigoSeguridad: String? = null
    )

    /**
     * Analiza el texto de la notificación y extrae los datos del pago si coincide con alguno de los patrones.
     */
    fun parse(title: String?, text: String?, timestamp: Long = System.currentTimeMillis()): ParsedPayment? {
        if (text == null) return null
        
        // Intentar con el Patrón A (Tradicional)
        val matcherA = patternA.matcher(text)
        if (matcherA.find()) {
            val amountStr = matcherA.group(1) ?: return null
            val senderStr = matcherA.group(2) ?: return null
            
            val amount = parseAmount(amountStr)
            val sender = senderStr.trim().removeSuffix(".")
            
            return ParsedPayment(sender, amount, timestamp, null)
        }

        // Intentar con el Patrón B (Nuevo/Confirmación de Pago)
        val matcherB = patternB.matcher(text)
        if (matcherB.find()) {
            val senderStr = matcherB.group(1) ?: return null
            val amountStr = matcherB.group(2) ?: return null
            
            val amount = parseAmount(amountStr)
            val sender = senderStr.trim().removeSuffix(".")
            
            // Extraer el código de seguridad si el grupo 3 está presente
            val codigoSeguridad = if (matcherB.groupCount() >= 3) matcherB.group(3) else null
            
            return ParsedPayment(sender, amount, timestamp, codigoSeguridad)
        }
        
        return null
    }

    /**
     * Convierte la cadena del monto a un Double de forma tolerante a formatos regionales (coma o punto decimal).
     */
    fun parseAmount(amountStr: String): Double {
        var clean = amountStr.trim().removeSuffix(".")
        
        // Caso de miles con punto/coma mezclados, por ejemplo "1,250.00" o "1.250,00"
        if (clean.contains(",") && clean.contains(".")) {
            val commaIndex = clean.indexOf(",")
            val dotIndex = clean.indexOf(".")
            if (commaIndex < dotIndex) {
                // Coma es miles, punto es decimal (e.g. 1,250.00)
                clean = clean.replace(",", "")
            } else {
                // Punto es miles, coma es decimal (e.g. 1.250,00)
                clean = clean.replace(".", "").replace(",", ".")
            }
        } else if (clean.contains(",")) {
            // Solo tiene coma (e.g. "50,00" o "1,250")
            val parts = clean.split(",")
            if (parts.size == 2 && parts[1].length <= 2) {
                // Separador decimal (e.g. "50,00")
                clean = clean.replace(",", ".")
            } else {
                // Separador de miles sin centavos (e.g. "1,250")
                clean = clean.replace(",", "")
            }
        }
        
        return clean.toDoubleOrNull() ?: 0.0
    }
}
