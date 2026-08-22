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
    // Patrón A (Tradicional Yape): "Te yapeó S/ 10.00 de Juan Perez" o "Te han yapeado S/ 50.00 de Pedro."
    private val patternA = Pattern.compile(
        "(?i)(?:te yapeó|te yapeo|te yapearon|te han yapeado)\\s+s/?\\s*([0-9.,]+)\\s+de\\s+(.+)"
    )

    // Patrón B (Nuevo formato Yape): "Lidia Cas* te envió un pago por S/ 1. El cód. de seguridad es: 296"
    // También soporta: "Yape! Jeferson ricardo Dilas barra te envió un pago por S/ 1.00"
    // y "Confirmación de Pago: Yape! Jeferson..."
    private val patternB = Pattern.compile(
        "(?i)(?:confirmaci[oó]n\\s+de\\s+pago:?\\s*)?(?:[¡!]?yape[!]?:?\\s*)?(.+?)\\s+te\\s+(?:envi[oó])\\s+un\\s+pago\\s+por\\s+s/?\\.?\\s*([0-9]+(?:[.,]\\d+)?)(?:[\\s.]*(?:el\\s+)?c[oó]d\\.?\\s*(?:de\\s+seguridad)?\\s*(?:es)?:?\\s*(\\d+))?"
    )

    // Patrón C (BBVA / Cobro con QR): "JEFERSON RICARDO DILAS BARRA te hizo un pago de S/ 1.0"
    // También soporta: "Cobro con QR: SANDRO RISSO MORON te hizo un pago de S/ 23.9"
    private val patternBBVA = Pattern.compile(
        "(?i)(?:cobro\\s+con\\s+qr:?\\s*)?(.+?)\\s+te\\s+hizo\\s+un\\s+pago\\s+(?:de|por)\\s+s/?\\.?\\s*([0-9]+(?:[.,]\\d+)?)(?:[\\s.]*(?:el\\s+)?c[oó]d\\.?\\s*(?:de\\s+seguridad)?\\s*(?:es)?:?\\s*(\\d+))?"
    )

    // Patrón para limpiar prefijos residuales del nombre del remitente
    private val prefixCleanupPattern = Pattern.compile("(?i)^(?:confirmaci[oó]n\\s+de\\s+pago:?\\s*|[¡!]?yape[!]?:?\\s*|cobro\\s+con\\s+qr:?\\s*|bbva(?:\\s+empresas)?:?\\s*)+")

    data class ParsedPayment(
        val remitente: String,
        val monto: Double,
        val timestamp: Long,
        val codigoSeguridad: String? = null,
        val banco: String = "YAPE"
    )

    /**
     * Limpia el nombre del remitente eliminando prefijos "Yape!", "BBVA", "Cobro con QR" o "Confirmación de Pago" y caracteres sobrantes.
     */
    private fun cleanSender(raw: String): String {
        var cleaned = raw.trim().removeSuffix(".")
        cleaned = prefixCleanupPattern.matcher(cleaned).replaceAll("")
        return cleaned.trim()
    }

    /**
     * Analiza el texto de la notificación y extrae los datos del pago si coincide con alguno de los patrones.
     */
    fun parse(title: String?, text: String?, timestamp: Long = System.currentTimeMillis(), packageName: String? = null): ParsedPayment? {
        if (text == null) return null
        
        val contextText = "${title.orEmpty()} $text ${packageName.orEmpty()}".lowercase()
        val isBbvaContext = contextText.contains("bbva") || contextText.contains("cobro con qr") || contextText.contains("te hizo un pago")

        // Intentar con el Patrón C (BBVA: "X te hizo un pago de S/ Y")
        val matcherBBVA = patternBBVA.matcher(text)
        if (matcherBBVA.find()) {
            val senderStr = matcherBBVA.group(1) ?: return null
            val amountStr = matcherBBVA.group(2) ?: return null
            
            val amount = parseAmount(amountStr)
            val sender = cleanSender(senderStr)
            val codigoSeguridad = if (matcherBBVA.groupCount() >= 3) matcherBBVA.group(3) else null
            
            return ParsedPayment(sender, amount, timestamp, codigoSeguridad, banco = "BBVA")
        }

        // Intentar con el Patrón A (Tradicional Yape: "Te yapeó S/ X de Y")
        val matcherA = patternA.matcher(text)
        if (matcherA.find()) {
            val amountStr = matcherA.group(1) ?: return null
            val senderStr = matcherA.group(2) ?: return null
            
            val amount = parseAmount(amountStr)
            val sender = cleanSender(senderStr)
            val banco = if (isBbvaContext) "BBVA" else "YAPE"
            
            return ParsedPayment(sender, amount, timestamp, null, banco = banco)
        }

        // Intentar con el Patrón B (Nuevo/Confirmación de Pago: "X te envió un pago por S/ Y")
        val matcherB = patternB.matcher(text)
        if (matcherB.find()) {
            val senderStr = matcherB.group(1) ?: return null
            val amountStr = matcherB.group(2) ?: return null
            
            val amount = parseAmount(amountStr)
            val sender = cleanSender(senderStr)
            
            // Extraer el código de seguridad si el grupo 3 está presente
            val codigoSeguridad = if (matcherB.groupCount() >= 3) matcherB.group(3) else null
            val banco = if (isBbvaContext) "BBVA" else "YAPE"
            
            return ParsedPayment(sender, amount, timestamp, codigoSeguridad, banco = banco)
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
