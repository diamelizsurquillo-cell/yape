
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Speech

[System.Media.SystemSounds]::Asterisk.Play()
Start-Sleep -Milliseconds 400

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = 1
$synth.Volume = 100
$synth.SpeakAsync('Yape! 1 sol')

[System.Windows.Forms.MessageBox]::Show(
    "Monto: S/ 1.00`nCliente: PAGO DE PRUEBA YAPE`nCodigo: 999",
    "YAPE RECIBIDO!",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information,
    [System.Windows.Forms.MessageBoxDefaultButton]::Button1,
    [System.Windows.Forms.MessageBoxOptions]::DefaultDesktopOnly
)
