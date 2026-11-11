Add-Type -AssemblyName System.Drawing

function New-AppIcon {
    param(
        [int]$Size,
        [string]$OutPath,
        [bool]$Maskable
    )

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $rect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
    $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect,
        [System.Drawing.Color]::FromArgb(255, 13, 148, 136),
        [System.Drawing.Color]::FromArgb(255, 12, 74, 110),
        45.0)
    $g.FillRectangle($bg, $rect)

    $scale = if ($Maskable) { 0.54 } else { 0.64 }
    $cx = $Size / 2.0
    $cy = $Size / 2.0
    $pinTop = $cy - $Size * $scale * 0.55
    $pinBottom = $cy + $Size * $scale * 0.62
    $r = $Size * $scale * 0.30
    $headCy = $pinTop + $r

    $pinPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $pinPath.FillMode = [System.Drawing.Drawing2D.FillMode]::Winding
    $pinPath.AddEllipse([float]($cx - $r), [float]($headCy - $r), [float](2 * $r), [float](2 * $r))
    $tail = New-Object System.Drawing.Drawing2D.GraphicsPath
    $tail.FillMode = [System.Drawing.Drawing2D.FillMode]::Winding
    $tail.AddPolygon([System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF([float]($cx - $r * 0.58), [float]($headCy + $r * 0.34))),
        (New-Object System.Drawing.PointF([float]($cx + $r * 0.58), [float]($headCy + $r * 0.34))),
        (New-Object System.Drawing.PointF([float]$cx, [float]$pinBottom))
    ))
    $pinPath.AddPath($tail, $false)

    $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $g.FillPath($white, $pinPath)

    $hs = $r * 0.80
    $hx = $cx
    $hy = $headCy - $hs * 0.05
    $heart = New-Object System.Drawing.Drawing2D.GraphicsPath
    $heart.AddBezier(
        [float]$hx, [float]($hy + $hs * 0.33),
        [float]($hx - $hs * 0.62), [float]($hy - $hs * 0.16),
        [float]($hx - $hs * 0.30), [float]($hy - $hs * 0.58),
        [float]$hx, [float]($hy - $hs * 0.22))
    $heart.AddBezier(
        [float]$hx, [float]($hy - $hs * 0.22),
        [float]($hx + $hs * 0.30), [float]($hy - $hs * 0.58),
        [float]($hx + $hs * 0.62), [float]($hy - $hs * 0.16),
        [float]$hx, [float]($hy + $hs * 0.33))
    $heart.CloseFigure()

    $heartBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect,
        [System.Drawing.Color]::FromArgb(255, 244, 63, 94),
        [System.Drawing.Color]::FromArgb(255, 225, 29, 72),
        45.0)
    $g.FillPath($heartBrush, $heart)

    $g.Dispose()
    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $pinPath.Dispose()
    $tail.Dispose()
    $heart.Dispose()
    $bg.Dispose()
    $white.Dispose()
    $heartBrush.Dispose()
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
