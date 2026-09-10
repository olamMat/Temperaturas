<#
.SYNOPSIS
    Sincroniza los reportes locales de temperaturas con la base de datos Turso.
.DESCRIPTION
    Lee ReporteTemperaturas.json y ReporteVerticales.json generados en el servidor,
    detecta automáticamente cuáles filas son nuevas (para no duplicar registros),
    y las inserta de forma incremental y eficiente en Turso Database.
#>

# =========================================================
# CONFIGURACIÓN
# =========================================================
$TursoUrl   = "https://temperaturas-db-olam.aws-us-east-1.turso.io/v2/pipeline"
$TursoToken = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODg5NzYzNTQsImlkIjoiMDFhMDg3NGItNTQwMS03M2YyLTkxOTgtZjlhZGEyNDE4OGM2Iiwia2lkIjoiY0RqOXp4aUJQbnRqY2k0THNTZ25GdWpPR3B1ZGpDSHR2aDNhOVRHNG1ZQSIsInJpZCI6ImE3ZmY5OGQyLTdjZWYtNDU0Ni1iZWUxLTZkOWI4MjJiOTQ4ZCJ9.UDLMI1_55Ol9LMZnuhpkIxATbpzEKmB77vEo8n57tLc1825AtQL15RVKrVPVSc0FqlmKps3AEsfOzHH93FOGDg"

$fileHorizontales = "C:\Repos\TemperaturasRepo\ReporteTemperaturas.json"
$fileVerticales   = "C:\Repos\TemperaturasRepo\ReporteVerticales.json"

# =========================================================
# FUNCIONES AUXILIARES DE TURSO
# =========================================================
function Invoke-TursoPipeline {
    param(
        [Parameter(Mandatory = $true)]
        [array]$Requests
    )

    $headers = @{
        "Authorization" = "Bearer $TursoToken"
        "Content-Type"  = "application/json"
    }

    $body = @{ requests = $Requests } | ConvertTo-Json -Depth 8
    return Invoke-RestMethod -Uri $TursoUrl -Method Post -Headers $headers -Body $body
}

function Ensure-TursoTables {
    $sqls = @(
        @"
        CREATE TABLE IF NOT EXISTS ReporteTemperaturas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            Time_Stamp TEXT NOT NULL,
            "Secadora 1" REAL, "Secadora 2" REAL, "Secadora 3" REAL,
            "Secadora 4" REAL, "Secadora 5" REAL, "Secadora 6" REAL,
            "Secadora 7" REAL, "Secadora 8" REAL, "Secadora 9" REAL,
            "Secadora 10" REAL, "Secadora 11" REAL, "Secadora 12" REAL,
            "Secadora 13" REAL, "Secadora 14" REAL, "Secadora 15" REAL,
            "Secadora 16" REAL, "Secadora 17" REAL, "Secadora 18" REAL
        );
"@,
        @"
        CREATE TABLE IF NOT EXISTS ReporteVerticales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            Time_Stamp TEXT NOT NULL,
            "Secadora Vertical 1" REAL, "Secadora Vertical 2" REAL,
            "Secadora Vertical 3" REAL, "Secadora Vertical 4" REAL,
            "Secadora Vertical 5" REAL, "Secadora Vertical 6" REAL
        );
"@
    )

    $reqs = @()
    foreach ($sql in $sqls) {
        $reqs += @{
            type = "execute"
            stmt = @{ sql = $sql }
        }
    }
    $reqs += @{ type = "close" }

    Invoke-TursoPipeline -Requests $reqs | Out-Null
}

function Get-TursoUltimoTimestamp {
    param([string]$Tabla)
    try {
        $reqs = @(
            @{
                type = "execute"
                stmt = @{ sql = "SELECT Time_Stamp FROM $Tabla ORDER BY id DESC LIMIT 1" }
            },
            @{ type = "close" }
        )
        $res = Invoke-TursoPipeline -Requests $reqs
        $rows = $res.results[0].response.result.rows
        if ($rows -and $rows.Count -gt 0) {
            return $rows[0][0].value
        }
    } catch {
        Write-Warning "No se pudo consultar el último timestamp de $Tabla. Se asumirá base vacía."
    }
    return $null
}

function Insert-TursoRowsBatch {
    param(
        [string]$Tabla,
        [array]$Rows,
        [array]$Columns,
        [int]$BatchSize = 100
    )

    if ($null -eq $Rows -or $Rows.Count -eq 0) {
        Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] No hay filas nuevas para $Tabla." -ForegroundColor Yellow
        return
    }

    $validCols = $Columns | Where-Object { $_ -ne "id" }
    $colNames = ($validCols | ForEach-Object { "`"$_`"" }) -join ", "
    $placeholders = (@("?") * $validCols.Count) -join ", "
    $sqlInsert = "INSERT INTO $Tabla ($colNames) VALUES ($placeholders)"

    Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Insertando $($Rows.Count) filas en Turso [$Tabla]..." -ForegroundColor Cyan

    for ($i = 0; $i -lt $Rows.Count; $i += $BatchSize) {
        $chunk = $Rows[$i..[Math]::Min($i + $BatchSize - 1, $Rows.Count - 1)]
        $requests = @()

        foreach ($r in $chunk) {
            $stmtArgs = @()
            foreach ($c in $validCols) {
                $val = $r.$c
                if ($null -eq $val -or [DBNull]::Value.Equals($val) -or $val -eq "") {
                    $stmtArgs += @{ type = "null" }
                } elseif ($c -eq "Time_Stamp") {
                    $stmtArgs += @{ type = "text"; value = [string]$val }
                } else {
                    $num = 0.0
                    if ([double]::TryParse([string]$val, [ref]$num)) {
                        $stmtArgs += @{ type = "float"; value = $num }
                    } else {
                        $stmtArgs += @{ type = "text"; value = [string]$val }
                    }
                }
            }

            $requests += @{
                type = "execute"
                stmt = @{
                    sql  = $sqlInsert
                    args = $stmtArgs
                }
            }
        }

        $requests += @{ type = "close" }
        Invoke-TursoPipeline -Requests $requests | Out-Null
    }

    Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] ✅ $($Rows.Count) filas sincronizadas en Turso [$Tabla]." -ForegroundColor Green
}

# =========================================================
# EJECUCIÓN PRINCIPAL
# =========================================================
try {
    # 1. Asegurar tablas creadas en Turso
    Ensure-TursoTables

    # 2. Procesar ReporteTemperaturas.json (Horizontales)
    if (Test-Path $fileHorizontales) {
        $jsonObjH = Get-Content -Path $fileHorizontales -Raw -Encoding UTF8 | ConvertFrom-Json
        $rowsH = $jsonObjH.rows
        $colsH = $jsonObjH.columns

        $ultimoTsH = Get-TursoUltimoTimestamp -Tabla "ReporteTemperaturas"

        if ($null -eq $ultimoTsH) {
            # Primera vez: subir todo el histórico
            Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Población inicial: Subiendo todo el archivo Horizontales a Turso..." -ForegroundColor Yellow
            Insert-TursoRowsBatch -Tabla "ReporteTemperaturas" -Rows $rowsH -Columns $colsH
        } else {
            # Subir solo las filas posteriores al último timestamp
            $idxUltimo = -1
            for ($k = $rowsH.Count - 1; $k -ge 0; $k--) {
                if ($rowsH[$k].Time_Stamp -eq $ultimoTsH) {
                    $idxUltimo = $k
                    break
                }
            }

            if ($idxUltimo -ge 0 -and $idxUltimo -lt ($rowsH.Count - 1)) {
                $nuevasFilasH = $rowsH[($idxUltimo + 1)..($rowsH.Count - 1)]
                Insert-TursoRowsBatch -Tabla "ReporteTemperaturas" -Rows $nuevasFilasH -Columns $colsH
            } elseif ($idxUltimo -eq -1) {
                # No se encontró exactamente (posible ventana rotativa), subir las últimas 20 por seguridad
                Write-Host "Revisando ultimas filas de Horizontales..."
                $ultimasH = $rowsH | Select-Object -Last 10
                Insert-TursoRowsBatch -Tabla "ReporteTemperaturas" -Rows $ultimasH -Columns $colsH
            } else {
                Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] ReporteTemperaturas ya está al día en Turso." -ForegroundColor Gray
            }
        }
    } else {
        Write-Warning "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] No se encontró el archivo: $fileHorizontales"
    }

    # 3. Procesar ReporteVerticales.json (Verticales)
    if (Test-Path $fileVerticales) {
        $jsonObjV = Get-Content -Path $fileVerticales -Raw -Encoding UTF8 | ConvertFrom-Json
        $rowsV = $jsonObjV.rows
        $colsV = $jsonObjV.columns

        $ultimoTsV = Get-TursoUltimoTimestamp -Tabla "ReporteVerticales"

        if ($null -eq $ultimoTsV) {
            Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Población inicial: Subiendo todo el archivo Verticales a Turso..." -ForegroundColor Yellow
            Insert-TursoRowsBatch -Tabla "ReporteVerticales" -Rows $rowsV -Columns $colsV
        } else {
            $idxUltimoV = -1
            for ($k = $rowsV.Count - 1; $k -ge 0; $k--) {
                if ($rowsV[$k].Time_Stamp -eq $ultimoTsV) {
                    $idxUltimoV = $k
                    break
                }
            }

            if ($idxUltimoV -ge 0 -and $idxUltimoV -lt ($rowsV.Count - 1)) {
                $nuevasFilasV = $rowsV[($idxUltimoV + 1)..($rowsV.Count - 1)]
                Insert-TursoRowsBatch -Tabla "ReporteVerticales" -Rows $nuevasFilasV -Columns $colsV
            } elseif ($idxUltimoV -eq -1) {
                $ultimasV = $rowsV | Select-Object -Last 10
                Insert-TursoRowsBatch -Tabla "ReporteVerticales" -Rows $ultimasV -Columns $colsV
            } else {
                Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] ReporteVerticales ya está al día en Turso." -ForegroundColor Gray
            }
        }
    } else {
        Write-Warning "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] No se encontró el archivo: $fileVerticales"
    }

} catch {
    Write-Error "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Error al sincronizar con Turso: $_"
}
