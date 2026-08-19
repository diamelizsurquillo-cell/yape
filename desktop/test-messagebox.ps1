Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Speech

# Sonido de campana de Windows
[System.Media.SystemSounds]::Asterisk.Play()
Start-Sleep -Milliseconds 400

# Voz por el parlante
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = 1
$synth.Volume = 100
$synth.SpeakAsync('Yape! 50 soles')

# Ventana SIEMPRE al frente
[System.Windows.Forms.MessageBox]::Show(
    "Monto: S/ 50.00`nCliente: Juan Perez`nCodigo: 999",
    "YAPE RECIBIDO!",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information,
    [System.Windows.Forms.MessageBoxDefaultButton]::Button1,
    [System.Windows.Forms.MessageBoxOptions]::DefaultDesktopOnly
)
