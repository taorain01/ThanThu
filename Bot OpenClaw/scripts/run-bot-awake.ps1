[CmdletBinding(DefaultParameterSetName = 'Launch')]
param(
  [Parameter(Mandatory = $true, ParameterSetName = 'Launch')]
  [string]$NodePath,

  [Parameter(Mandatory = $true, ParameterSetName = 'Launch')]
  [string]$EntryPath,

  [Parameter(Mandatory = $true, ParameterSetName = 'Attach')]
  [ValidateRange(1, [int]::MaxValue)]
  [int]$ExistingProcessId
)

$ErrorActionPreference = 'Stop'

if ($PSCmdlet.ParameterSetName -eq 'Launch') {
  if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
    throw "Node executable not found: $NodePath"
  }
  if (-not (Test-Path -LiteralPath $EntryPath -PathType Leaf)) {
    throw "Bot entry point not found: $EntryPath"
  }
}
else {
  Get-Process -Id $ExistingProcessId -ErrorAction Stop | Out-Null
}

$executionStateSource = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class OpenClawExecutionState
{
    private const uint EsSystemRequired = 0x00000001;
    private const uint EsContinuous = 0x80000000;

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint SetThreadExecutionState(uint esFlags);

    public static void PreventSystemSleep()
    {
        if (SetThreadExecutionState(EsContinuous | EsSystemRequired) == 0)
        {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }
    }

    public static void AllowSystemSleep()
    {
        SetThreadExecutionState(EsContinuous);
    }
}
'@

Add-Type -TypeDefinition $executionStateSource

$exitCode = 1
try {
  # Keep Windows awake without requesting that the display remain powered on.
  [OpenClawExecutionState]::PreventSystemSleep()
  if ($PSCmdlet.ParameterSetName -eq 'Attach') {
    Wait-Process -Id $ExistingProcessId
    $exitCode = 0
  }
  else {
    & $NodePath $EntryPath
    $exitCode = if ($null -eq $LASTEXITCODE) { 1 } else { $LASTEXITCODE }
  }
}
finally {
  [OpenClawExecutionState]::AllowSystemSleep()
}

exit $exitCode
