package com.minegocio.yapesensor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class YapeNotificationParserTest {

    @Test
    fun testParseStandardPayment() {
        val text = "Te yapeó S/ 20.00 de Juan Perez"
        val result = YapeNotificationParser.parse("Yape", text)
        assertNotNull(result)
        assertEquals("Juan Perez", result?.remitente)
        assertEquals(20.0, result?.monto ?: 0.0, 0.001)
        assertEquals(null, result?.codigoSeguridad)
    }

    @Test
    fun testParseNoSpaceAndNoDecimals() {
        val text = "Te yapeó S/15 de Carlos"
        val result = YapeNotificationParser.parse("Yape", text)
        assertNotNull(result)
        assertEquals("Carlos", result?.remitente)
        assertEquals(15.0, result?.monto ?: 0.0, 0.001)
    }

    @Test
    fun testParseCommaDecimal() {
        val text = "Te yapeó S/ 5,50 de Maria Gomez"
        val result = YapeNotificationParser.parse("Yape", text)
        assertNotNull(result)
        assertEquals("Maria Gomez", result?.remitente)
        assertEquals(5.5, result?.monto ?: 0.0, 0.001)
    }

    @Test
    fun testParseThousandsSeparator() {
        val text = "Te yapeó S/ 1,250.00 de Ana Ramos"
        val result = YapeNotificationParser.parse("Yape", text)
        assertNotNull(result)
        assertEquals("Ana Ramos", result?.remitente)
        assertEquals(1250.0, result?.monto ?: 0.0, 0.001)
    }

    @Test
    fun testParseTeHanYapeadoWithTrailingDot() {
        val text = "Te han yapeado S/ 50.00 de Pedro."
        val result = YapeNotificationParser.parse("Yape", text)
        assertNotNull(result)
        assertEquals("Pedro", result?.remitente)
        assertEquals(50.0, result?.monto ?: 0.0, 0.001)
    }

    @Test
    fun testParseNewNotificationFormat() {
        val text = "Lidia Cas* te envió un pago por S/ 1. El cód. de seguridad es: 296"
        val result = YapeNotificationParser.parse("Yape", text)
        assertNotNull(result)
        assertEquals("Lidia Cas*", result?.remitente)
        assertEquals(1.0, result?.monto ?: 0.0, 0.001)
        assertEquals("296", result?.codigoSeguridad)
    }

    @Test
    fun testParseNewNotificationFormatWithDecimal() {
        val text = "Juan Perez te envió un pago por S/ 15.50. El cód. de seguridad es: 104"
        val result = YapeNotificationParser.parse("Yape", text)
        assertNotNull(result)
        assertEquals("Juan Perez", result?.remitente)
        assertEquals(15.5, result?.monto ?: 0.0, 0.001)
        assertEquals("104", result?.codigoSeguridad)
    }
}
