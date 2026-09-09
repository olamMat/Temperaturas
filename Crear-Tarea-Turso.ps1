<#
.SYNOPSIS
    Registra la tarea programada en Windows para sincronizar con Turso cada 5 minutos.
#>

$taskName = "Sync-Turso-Temperaturas"
$scriptPath = "C:\Repos\TemperaturasRepo\Sync-Turso.ps1"

# Acción: Ejecutar PowerShell oculto sin restricciones de política
$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`""

# Disparador: Iniciar de inmediato y repetir cada 5 minutos indefinidamente
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)

# Opciones: Ejecutar tan pronto esté disponible y evitar solapamientos
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew

try {
    Register-ScheduledTask -TaskName $taskName -Action $Action -Trigger $Trigger -Settings $Settings -RunLevel Highest -Force
    Write-Host "✅ Tarea programada '$taskName' creada exitosamente. Se ejecutará cada 5 minutos hacia Turso." -ForegroundColor Green
} catch {
    Write-Error "❌ Hubo un error al crear la tarea programada: $_"
}
