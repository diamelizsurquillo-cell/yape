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
        assertEquals("YAPE", result?.banco)
    }

    @Test
    fun testParseBbvaQrPayments() {
        val text1 = "JEFERSON RICARDO DILAS BARRA te hizo un pago de S/ 1.0"
        val result1 = YapeNotificationParser.parse("Cobro con QR", text1, packageName = "pe.bbva.empresas")
        assertNotNull(result1)
        assertEquals("JEFERSON RICARDO DILAS BARRA", result1?.remitente)
        assertEquals(1.0, result1?.monto ?: 0.0, 0.001)
        assertEquals("BBVA", result1?.banco)

        val text2 = "SANDRO RISSO MORON te hizo un pago de S/ 23.9"
        val result2 = YapeNotificationParser.parse("Cobro con QR", text2)
        assertNotNull(result2)
        assertEquals("SANDRO RISSO MORON", result2?.remitente)
        assertEquals(23.9, result2?.monto ?: 0.0, 0.001)
        assertEquals("BBVA", result2?.banco)

        val text3 = "RAQUEL IRINA SANCHEZ BUENDIA te hizo un pago de S/ 15.9"
        val result3 = YapeNotificationParser.parse("Cobro con QR", text3)
        assertNotNull(result3)
        assertEquals("RAQUEL IRINA SANCHEZ BUENDIA", result3?.remitente)
        assertEquals(15.9, result3?.monto ?: 0.0, 0.001)
        assertEquals("BBVA", result3?.banco)

        val text4 = "BARBARA ROSE CHAC VELA te hizo un pago de S/ 49.9"
        val result4 = YapeNotificationParser.parse("Cobro con QR", text4)
        assertNotNull(result4)
        assertEquals("BARBARA ROSE CHAC VELA", result4?.remitente)
        assertEquals(49.9, result4?.monto ?: 0.0, 0.001)
        assertEquals("BBVA", result4?.banco)
    }
}
