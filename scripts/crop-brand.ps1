Add-Type -AssemblyName System.Drawing
$source = [System.Drawing.Bitmap]::FromFile('C:\Users\DANIEL\Downloads\ChatGPT Image 2026年9月9日 21_12_42.png')
$destination = Join-Path $PSScriptRoot '../apps/web/public/brand'
[System.IO.Directory]::CreateDirectory($destination) | Out-Null
try {
  foreach ($crop in @(@('picup-wordmark.png',265,275,750,370), @('picup-icon.png',521,824,220,205))) {
    $rect = [System.Drawing.Rectangle]::new($crop[1],$crop[2],$crop[3],$crop[4])
    $bitmap = $source.Clone($rect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try { $bitmap.Save((Join-Path $destination $crop[0]), [System.Drawing.Imaging.ImageFormat]::Png) } finally { $bitmap.Dispose() }
  }
} finally { $source.Dispose() }
