package com.minegocio.yapesensor

import java.util.regex.Pattern

object YapeNotificationParser {

    // Patrón 1: Remitente al inicio -> "X te yapeó / envió / transfirió / hizo un pago [de/por] S/ Y"
    // Ejemplos:
    // - "Juan Perez te yapeó S/ 10.00"
    // - "Lidia Cas* te envió un pago por S/ 1. El cód. de seguridad es: 296"
    // - "Juan Perez te envió un pago de S/ 10.00"
    // - "Maria Quispe te envió S/ 25.50"
    // - "Carlos Torres te transfirió S/ 80.00"
    // - "Ana Lopez te acaba de yapear S/ 50.00"
    // - "JEFERSON RICARDO DILAS BARRA te hizo un pago de S/ 1.0"
    private val patternSenderFirst = Pattern.compile(
        "(?i)^(.+?)\\s+te\\s+(?:yape[oó]|acaba\\s+de\\s+yapear|envi[oó](?:\\s+un\\s+pago)?|transfiri[oó](?:\\s+un\\s+pago)?|ha\\s+enviado|ha\\s+yapeado|hizo\\s+un\\s+pago)\\s+(?:por|de)?\\s*s/?\\.?\\s*([0-9]+(?:[.,][0-9]+)*)"
    )

    // Patrón 2: Acción al inicio -> "Te yapeó / te yapearon / te han yapeado / te llegó un yape / recibiste S/ Y de X"
    // Ejemplos:
    // - "Te yapeó S/ 20.00 de Juan Perez"
    // - "Te yapeó S/ 1,250.00 de Ana Ramos"
    // - "Te han yapeado S/ 50.00 de Pedro."
    // - "Te acaban de yapear S/ 35.00 de Raul Diaz"
    // - "Te llegó un yape de S/ 40.00 de Sofia Castro"
    // - "Recibiste un Yape de S/ 12.00 de Luis Ramos"
    // - "Recibiste S/ 18.00 de Carmen Soto"
    // - "Has recibido un pago de S/ 70.00 de Fernando Alva"
    private val patternActionFirst = Pattern.compile(
        "(?i)(?:te\\s+yape[oó]|te\\s+yapearon|te\\s+han\\s+yapeado|te\\s+acaban\\s+de\\s+yapear|te\\s+lleg[oó]\\s+un\\s+yape|te\\s+lleg[oó]\\s+un\\s+pago|te\\s+transfirieron|te\\s+pline[oó]|recibiste(?:\\s+un\\s+yape|\\s+un\\s+pago)?|has\\s+recibido(?:\\s+un\\s+yape|\\s+un\\s+pago)?)\\s+(?:de|por)?\\s*s/?\\.?\\s*([0-9]+(?:[.,][0-9]+)*)\\s+de\\s+(.+)"
    )

    // Patrón 3: "Has recibido / Recibiste [un Yape] de X por/de S/ Y"
    // Ejemplo: "Has recibido un Yape de Juan Perez por S/ 70.00"
    private val patternReceivedFromSender = Pattern.compile(
        "(?i)(?:has\\s+recibido|recibiste)(?:\\s+un\\s+yape|\\s+un\\s+pago)?\\s+de\\s+(.+?)\\s+(?:por|de)\\s+s/?\\.?\\s*([0-9]+(?:[.,][0-9]+)*)"
    )

    // Patrón 4: "¡Te yapearon! / ¡Yape! S/ Y de X" o "S/ Y de X"
    private val patternAmountThenSender = Pattern.compile(
        "(?i)(?:[¡!]?te\\s+yapearon[!]?|[¡!]?yape[!]?|pago\\s+recibido:?|nuevo\\s+pago:?)\\s*s/?\\.?\\s*([0-9]+(?:[.,][0-9]+)*)\\s+de\\s+(.+)"
    )

    // Patrón para extraer código de seguridad / validación en cualquier parte del texto
    // Soporta: "El cód. de seguridad es: 296", "Cód: 123", "Código de validación: 456", "Código: 789", "Tu código es 123"
    private val securityCodePattern = Pattern.compile(
        "(?i)(?:el\\s+)?c[oó]d(?:igo)?\\.?(?:\\s+de\\s+(?:seguridad|validaci[oó]n|verificaci[oó]n|aprobaci[oó]n))?\\s*(?:es)?:?\\s*(\\d{2,8})|tu\\s+c[oó]digo\\s+(?:es)?\\s*:?\\s*(\\d{2,8})"
    )

    // Patrón para extraer monto numérico aislado precedido por S/ o s/. o s/
    private val amountOnlyPattern = Pattern.compile(
        "(?i)s/?\\.?\\s*([0-9]+(?:[.,][0-9]+)*)"
    )

    // Patrón para limpiar prefijos comunes del nombre del remitente
    private val prefixCleanupPattern = Pattern.compile(
        "(?i)^(?:confirmaci[oó]n\\s+de\\s+pago:?\\s*|[¡!]?yape[!]?:?\\s*|[¡!]?te\\s+yapearon[!]?:?\\s*|cobro\\s+con\\s+qr:?\\s*|bbva(?:\\s+empresas)?:?\\s*|pago\\s+recibido:?\\s*|nuevo\\s+pago:?\\s*|plin:?\\s*|bcp:?\\s*|notificaci[oó]n:?\\s*)+"
    )

    // Lista de títulos que son genéricos del sistema y no son nombres de personas
    private val genericSystemTitles = listOf(
        "yape", "¡yape!", "yape!", "confirmación de pago", "confirmacion de pago",
        "cobro con qr", "bbva", "bbva empresas", "pago recibido", "nuevo pago",
        "te yapearon", "¡te yapearon!", "plin", "bcp", "notificación", "notificacion",
        "alerta", "banca móvil", "banca movil"
    )

    data class ParsedPayment(
        val remitente: String,
        val monto: Double,
        val timestamp: Long,
        val codigoSeguridad: String? = null,
        val banco: String = "YAPE"
    )

    /**
     * Limpia el nombre del remitente eliminando prefijos y sufijos no deseados.
     */
    fun cleanSender(raw: String): String {
        var cleaned = raw.trim()
        cleaned = prefixCleanupPattern.matcher(cleaned).replaceAll("")
        // Eliminar puntos finales o comas
        cleaned = cleaned.trim().removeSuffix(".").removeSuffix(",").trim()
        return cleaned
    }

    /**
     * Extrae el código de seguridad o validación si se encuentra presente en el texto.
     */
    fun extractSecurityCode(text: String): String? {
        val matcher = securityCodePattern.matcher(text)
        if (matcher.find()) {
            return matcher.group(1) ?: matcher.group(2)
        }
        return null
    }

    /**
     * Infiere el nombre del banco ('BBVA', 'PLIN' o 'YAPE') según el paquete y texto.
     */
    private fun detectBank(contextText: String, packageName: String?): String {
        val lowerContext = contextText.lowercase()
        val lowerPkg = (packageName ?: "").lowercase()

        if (lowerPkg.contains("bbva") || lowerContext.contains("bbva") || lowerContext.contains("cobro con qr") || lowerContext.contains("te hizo un pago")) {
            return "BBVA"
        }
        if (lowerPkg.contains("plin") || lowerContext.contains("plin") || lowerContext.contains("te plineó") || lowerContext.contains("te plineo")) {
            return "PLIN"
        }
        return "YAPE"
    }

    /**
     * Analiza el texto y título de la notificación y extrae los datos del pago.
     */
    fun parse(title: String?, text: String?, timestamp: Long = System.currentTimeMillis(), packageName: String? = null): ParsedPayment? {
        if (text == null && title == null) return null

        val safeText = text.orEmpty().trim()
        val safeTitle = title.orEmpty().trim()
        val fullCombined = "$safeTitle $safeText".trim()
        val detectedBank = detectBank("$fullCombined ${packageName.orEmpty()}", packageName)
        val extractedSecurityCode = extractSecurityCode(fullCombined)

        // Limpieza previa del texto a analizar
        val cleanedText = prefixCleanupPattern.matcher(safeText).replaceAll("").trim()

        // 1. Probar Patrón 1: Remitente al inicio (ej: "Juan Perez te yapeó S/ 10.00")
        for (candidate in listOf(safeText, cleanedText, fullCombined)) {
            if (candidate.isBlank()) continue
            val m = patternSenderFirst.matcher(candidate)
            if (m.find()) {
                val senderRaw = m.group(1) ?: continue
                val amountStr = m.group(2) ?: continue
                val sender = cleanSender(senderRaw)
                val amount = parseAmount(amountStr)
                if (sender.isNotBlank() && amount > 0.0) {
                    return ParsedPayment(sender, amount, timestamp, extractedSecurityCode, banco = detectedBank)
                }
            }
        }

        // 2. Probar Patrón 2: Acción al inicio (ej: "Te yapeó S/ 20.00 de Juan Perez")
        for (candidate in listOf(safeText, fullCombined)) {
            if (candidate.isBlank()) continue
            val m = patternActionFirst.matcher(candidate)
            if (m.find()) {
                val amountStr = m.group(1) ?: continue
                val senderRaw = m.group(2) ?: continue
                val sender = cleanSender(senderRaw)
                val amount = parseAmount(amountStr)
                if (sender.isNotBlank() && amount > 0.0) {
                    return ParsedPayment(sender, amount, timestamp, extractedSecurityCode, banco = detectedBank)
                }
            }
        }

        // 3. Probar Patrón 3: "Has recibido un Yape de Juan Perez por S/ 70.00"
        for (candidate in listOf(safeText, fullCombined)) {
            if (candidate.isBlank()) continue
            val m = patternReceivedFromSender.matcher(candidate)
            if (m.find()) {
                val senderRaw = m.group(1) ?: continue
                val amountStr = m.group(2) ?: continue
                val sender = cleanSender(senderRaw)
                val amount = parseAmount(amountStr)
                if (sender.isNotBlank() && amount > 0.0) {
                    return ParsedPayment(sender, amount, timestamp, extractedSecurityCode, banco = detectedBank)
                }
            }
        }

        // 4. Probar Patrón 4: "¡Te yapearon! S/ 10.00 de Juan Perez"
        for (candidate in listOf(safeText, fullCombined)) {
            if (candidate.isBlank()) continue
            val m = patternAmountThenSender.matcher(candidate)
            if (m.find()) {
                val amountStr = m.group(1) ?: continue
                val senderRaw = m.group(2) ?: continue
                val sender = cleanSender(senderRaw)
                val amount = parseAmount(amountStr)
                if (sender.isNotBlank() && amount > 0.0) {
                    return ParsedPayment(sender, amount, timestamp, extractedSecurityCode, banco = detectedBank)
                }
            }
        }

        // 5. Estrategia de División Título / Contenido:
        // Si el título es el nombre del remitente (no es un título genérico del sistema)
        // y el texto contiene un monto "S/ XX.XX"
        val isGenericTitle = genericSystemTitles.any { safeTitle.equals(it, ignoreCase = true) }
        if (safeTitle.isNotBlank() && !isGenericTitle && safeTitle.length >= 3) {
            val amountMatcher = amountOnlyPattern.matcher(safeText)
            if (amountMatcher.find()) {
                val amountStr = amountMatcher.group(1) ?: ""
                val amount = parseAmount(amountStr)
                val sender = cleanSender(safeTitle)
                if (sender.isNotBlank() && amount > 0.0) {
                    return ParsedPayment(sender, amount, timestamp, extractedSecurityCode, banco = detectedBank)
                }
            }
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
