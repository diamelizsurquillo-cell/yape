Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Speech

[System.Media.SystemSounds]::Asterisk.Play()
Start-Sleep -Milliseconds 350

$canal   = if ($env:YAPE_CANAL)   { $env:YAPE_CANAL }   else { "YAPE" }
$monto   = if ($env:YAPE_MONTO)   { $env:YAPE_MONTO }   else { "0.00" }
$cliente = if ($env:YAPE_CLIENTE) { $env:YAPE_CLIENTE } else { "Cliente" }
$codigo  = if ($env:YAPE_CODIGO)  { $env:YAPE_CODIGO }  else { "-" }
$voz     = if ($env:YAPE_VOZ)     { $env:YAPE_VOZ }     else { "Pago recibido" }

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = 1
$synth.Volume = 100
$null = $synth.SpeakAsync($voz)

$bodyText = "Canal: $canal`r`nMonto: S/ $monto`r`nCliente: $cliente`r`nCodigo: $codigo"
$titleText = "$canal RECIBIDO!"

[void][System.Windows.Forms.MessageBox]::Show(
    $bodyText,
    $titleText,
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information,
    [System.Windows.Forms.MessageBoxDefaultButton]::Button1,
    [System.Windows.Forms.MessageBoxOptions]::DefaultDesktopOnly
)
