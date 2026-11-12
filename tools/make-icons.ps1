# ============================================================
#  Generatore delle icone di Mappo
#  ------------------------------------------------------------
#  Produce l'icona dell'app in tutte le varianti usate dal
#  manifest PWA, da index.html e dal README:
#    - icon-192.png / icon-512.png     (purpose "any")
#    - icon-maskable-512.png           (safe zone ridotta)
#    - apple-touch-icon.png            (180x180, senza trasparenza)
#    - favicon-32.png                  (32x32)
#
#  Disegno: pin a goccia bianco con foro centrale su sfondo
#  a gradiente diagonale (verde-acqua). Le varianti "maskable"
#  usano una scala più piccola per stare nella safe zone.
#
#  Uso:  powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1
# ============================================================

Add-Type -AssemblyName System.Drawing

function New-AppIcon {
    param(
        [int]$Size,
        [string]$OutPath,
        [bool]$Maskable
    )

    $bmp = [System.Drawing.Bitmap]::new($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

    $rect = [System.Drawing.Rectangle]::new(0, 0, $Size, $Size)

    # Sfondo a gradiente diagonale: verde-acqua chiaro in alto a
    # sinistra, verde-acqua profondo in basso a destra.
    $bg = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
        $rect,
        [System.Drawing.Color]::FromArgb(255, 45, 212, 191),
        [System.Drawing.Color]::FromArgb(255, 15, 118, 110),
        45.0)
    $g.FillRectangle($bg, $rect)

    # Geometria del pin (R = raggio della testa).
    # Altezza totale = 3.1 R (testa + coda), larghezza = 2 R.
    $pinHeight = $Size * $(if ($Maskable) { 0.50 } else { 0.62 })
    $R = $pinHeight / 3.1
    $cx = $Size / 2.0
    $headCy = $Size / 2.0 - 0.55 * $R
    $tipY = $headCy + 2.1 * $R

    $pin = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $pin.FillMode = [System.Drawing.Drawing2D.FillMode]::Winding
    $headRect = [System.Drawing.RectangleF]::new(
        [float]($cx - $R), [float]($headCy - $R), [float](2 * $R), [float](2 * $R))

    # Testa: semicerchio da sinistra a destra passing per l'alto.
    $pin.AddArc($headRect, 180.0, 180.0)

    # Lato destro: dalla cintura scende curvando verso la punta.
    $pin.AddBezier(
        [float]($cx + $R), [float]$headCy,
        [float]($cx + $R * 0.98), [float]($headCy + $R * 0.85),
        [float]($cx + $R * 0.30), [float]($tipY - $R * 0.35),
        [float]$cx, [float]$tipY)

    # Lato sinistro: simmetrico.
    $pin.AddBezier(
        [float]$cx, [float]$tipY,
        [float]($cx - $R * 0.30), [float]($tipY - $R * 0.35),
        [float]($cx - $R * 0.98), [float]($headCy + $R * 0.85),
        [float]($cx - $R), [float]$headCy)
    $pin.CloseFigure()

    $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
    $g.FillPath($white, $pin)

    # Foro centrale: mostra lo sfondo, come nei pin moderni.
    $holeR = $R * 0.42
    $g.FillEllipse($bg, [float]($cx - $holeR), [float]($headCy - $holeR),
        [float](2 * $holeR), [float](2 * $holeR))

    $g.Dispose()
    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $pin.Dispose()
    $bg.Dispose()
    $white.Dispose()
}

$root = Split-Path -Parent $PSScriptRoot
$icons = Join-Path $root "icons"
New-Item -ItemType Directory -Force -Path $icons | Out-Null

New-AppIcon -Size 192 -OutPath (Join-Path $icons "icon-192.png") -Maskable $false
New-AppIcon -Size 512 -OutPath (Join-Path $icons "icon-512.png") -Maskable $false
New-AppIcon -Size 512 -OutPath (Join-Path $icons "icon-maskable-512.png") -Maskable $true
New-AppIcon -Size 180 -OutPath (Join-Path $icons "apple-touch-icon.png") -Maskable $false
New-AppIcon -Size 32 -OutPath (Join-Path $icons "favicon-32.png") -Maskable $false

Get-ChildItem $icons | Select-Object Name, Length
