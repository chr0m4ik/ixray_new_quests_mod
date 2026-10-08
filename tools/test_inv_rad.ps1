# test_inv_rad.ps1 — запуск проверки расчёта радиации в инвентаре (tools\test_inv_rad.lua).
#
# Проверяет scripts\bq_inv_rad.script БЕЗ запуска игры: подсовывает заглушки
# движка (db.actor, iterate_inventory, is_on_belt, change_radiation,
# time_global, RegisterScriptCallback) и сверяет начисленную дозу с ожидаемой.
#
# Используется настоящий LuaJIT из игры (bin\lua51.dll), поэтому проверяется и
# синтаксис, и арифметика. Синтаксис всех скриптов аддона можно проверить так же:
# в блоке ниже достаточно списка файлов.
#
# Запуск из корня аддона:  pwsh -File tools\test_inv_rad.ps1

$ErrorActionPreference = 'Stop'

$addon = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$luaDll = Join-Path (Split-Path $addon -Parent) '..\bin\lua51.dll'
$luaDll = [System.IO.Path]::GetFullPath($luaDll)

if (-not (Test-Path -LiteralPath $luaDll)) {
    Write-Error "Не найден LuaJIT: $luaDll"
}

$code = @'
using System;
using System.Runtime.InteropServices;
public static class Lua51Runner {
  [DllImport("kernel32", SetLastError=true, CharSet=CharSet.Ansi)]
  public static extern IntPtr LoadLibrary(string name);
  [DllImport("lua51", CallingConvention=CallingConvention.Cdecl)]
  public static extern IntPtr luaL_newstate();
  [DllImport("lua51", CallingConvention=CallingConvention.Cdecl)]
  public static extern void luaL_openlibs(IntPtr L);
  [DllImport("lua51", CallingConvention=CallingConvention.Cdecl)]
  public static extern int luaL_loadfile(IntPtr L, string filename);
  [DllImport("lua51", CallingConvention=CallingConvention.Cdecl)]
  public static extern int lua_pcall(IntPtr L, int nargs, int nresults, int errfunc);
  [DllImport("lua51", CallingConvention=CallingConvention.Cdecl)]
  public static extern IntPtr lua_tolstring(IntPtr L, int idx, out UIntPtr len);
  [DllImport("lua51", CallingConvention=CallingConvention.Cdecl)]
  public static extern void lua_close(IntPtr L);
  [DllImport("lua51", CallingConvention=CallingConvention.Cdecl)]
  public static extern void lua_createtable(IntPtr L, int narr, int nrec);
  [DllImport("lua51", CallingConvention=CallingConvention.Cdecl)]
  public static extern void lua_pushstring(IntPtr L, string s);
  [DllImport("lua51", CallingConvention=CallingConvention.Cdecl)]
  public static extern void lua_rawseti(IntPtr L, int idx, int n);
  [DllImport("lua51", CallingConvention=CallingConvention.Cdecl)]
  public static extern void lua_setfield(IntPtr L, int idx, string k);
  // lua_setglobal в lua51.dll - это макрос (lua_setfield с LUA_GLOBALSINDEX).
  public const int GLOBALS = -10002;
  public static void SetGlobal(IntPtr L, string name) { lua_setfield(L, GLOBALS, name); }
  public static string Top(IntPtr L) {
    UIntPtr len;
    IntPtr p = lua_tolstring(L, -1, out len);
    if (p == IntPtr.Zero) return "(нет сообщения)";
    return Marshal.PtrToStringAnsi(p, (int)len);
  }
}
'@
Add-Type -TypeDefinition $code -ErrorAction Stop
[void][Lua51Runner]::LoadLibrary($luaDll)

$luaTest = Join-Path $PSScriptRoot 'test_inv_rad.lua'
$outFile = Join-Path $PSScriptRoot 'test_inv_rad_out.txt'
if (Test-Path -LiteralPath $outFile) { Remove-Item -LiteralPath $outFile -Force }

$L = [Lua51Runner]::luaL_newstate()
[Lua51Runner]::luaL_openlibs($L)

# arg = { [0] = <тест>, [1] = <папка аддона> }
$luaPathTest = $luaTest -replace '\\', '/'
$luaPathAddon = $addon -replace '\\', '/'
[Lua51Runner]::lua_createtable($L, 2, 0)
[Lua51Runner]::lua_pushstring($L, $luaPathTest);  [Lua51Runner]::lua_rawseti($L, -2, 0)
[Lua51Runner]::lua_pushstring($L, $luaPathAddon); [Lua51Runner]::lua_rawseti($L, -2, 1)
[Lua51Runner]::SetGlobal($L, 'arg')

$failed = $false
if ([Lua51Runner]::luaL_loadfile($L, $luaPathTest) -ne 0) {
    Write-Host ("ОШИБКА загрузки теста: " + [Lua51Runner]::Top($L)) -ForegroundColor Red
    $failed = $true
} else {
    if ([Lua51Runner]::lua_pcall($L, 0, 0, 0) -ne 0) {
        Write-Host ("ОШИБКА выполнения: " + [Lua51Runner]::Top($L)) -ForegroundColor Red
        $failed = $true
    }
}
[Lua51Runner]::lua_close($L)

if (Test-Path -LiteralPath $outFile) {
    $lines = Get-Content -LiteralPath $outFile -Encoding UTF8
    foreach ($line in $lines) {
        if ($line -eq '') { continue }
        if ($line -match '-> ОШИБКА' -or $line -match 'ОШИБКА') {
            Write-Host $line -ForegroundColor Red
            $failed = $true
        } else {
            Write-Host $line
        }
    }
    Remove-Item -LiteralPath $outFile -Force
} else {
    $failed = $true
}

if ($failed) {
    Write-Host 'ПРОВЕРКА НЕ ПРОЙДЕНА' -ForegroundColor Red
    exit 1
}
Write-Host 'OK: расчёт радиации в инвентаре верен.' -ForegroundColor Green
exit 0
