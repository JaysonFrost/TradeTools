import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export type VatagaLayoutRow = {
  workspaceId: string
  workspaceTitle: string
  tabTitle: string
  isActive: boolean
  x: number
  y: number
  width: number
  height: number
}

export type VatagaLayoutMatch = {
  workspaceId: string
  workspaceTitle: string
  tabTitle: string
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
}

const vatagaLayoutReaderScript = `
$ErrorActionPreference = 'Stop'
$appDir = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($args[0]))
$dbPath = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($args[1]))
$symbol = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($args[2])).ToUpperInvariant()
$env:PATH = (Join-Path $appDir 'runtimes\\win-x64\\native') + ';' + $env:PATH
$source = @"
using System;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

public static class TradeToolsVatagaLayoutSqlite {
  const int SQLITE_OK = 0;
  const int SQLITE_ROW = 100;
  const int SQLITE_DONE = 101;
  const int SQLITE_OPEN_READONLY = 1;

  [DllImport("e_sqlite3", CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_open_v2(byte[] filename, out IntPtr db, int flags, IntPtr vfs);
  [DllImport("e_sqlite3", CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_close(IntPtr db);
  [DllImport("e_sqlite3", CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_prepare_v2(IntPtr db, byte[] sql, int numBytes, out IntPtr stmt, IntPtr tail);
  [DllImport("e_sqlite3", CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_step(IntPtr stmt);
  [DllImport("e_sqlite3", CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_finalize(IntPtr stmt);
  [DllImport("e_sqlite3", CallingConvention = CallingConvention.Cdecl)] static extern IntPtr sqlite3_column_text(IntPtr stmt, int column);
  [DllImport("e_sqlite3", CallingConvention = CallingConvention.Cdecl)] static extern double sqlite3_column_double(IntPtr stmt, int column);
  [DllImport("e_sqlite3", CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_column_int(IntPtr stmt, int column);
  [DllImport("e_sqlite3", CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_bind_text(IntPtr stmt, int index, byte[] value, int byteCount, IntPtr destructor);
  [DllImport("e_sqlite3", CallingConvention = CallingConvention.Cdecl)] static extern IntPtr sqlite3_errmsg(IntPtr db);

  static byte[] Utf8z(string value) { return Encoding.UTF8.GetBytes((value ?? "") + "\\0"); }

  static string Utf8String(IntPtr ptr) {
    if (ptr == IntPtr.Zero) return "";
    int length = 0;
    while (Marshal.ReadByte(ptr, length) != 0) length++;
    byte[] buffer = new byte[length];
    Marshal.Copy(ptr, buffer, 0, length);
    return Encoding.UTF8.GetString(buffer);
  }

  static string Base64(string value) {
    return Convert.ToBase64String(Encoding.UTF8.GetBytes(value ?? ""));
  }

  public static string Query(string dbPath, string symbol) {
    IntPtr db;
    int opened = sqlite3_open_v2(Utf8z(dbPath), out db, SQLITE_OPEN_READONLY, IntPtr.Zero);
    if (opened != SQLITE_OK) throw new Exception("sqlite open failed: " + opened);

    IntPtr stmt = IntPtr.Zero;
    try {
      string sql = @"select w.ID, coalesce(w.Title, ''), coalesce(t.Title, ''), coalesce(t.IsActive, 0), coalesce(w.LocationX, 0), coalesce(w.LocationY, 0), coalesce(w.Width, 0), coalesce(w.Height, 0) from Dockings d join Tabs t on t.ID = d.TabOwnerID join Workspaces w on w.ID = t.WorkspaceID where upper(coalesce(d.Data, '')) like ?";
      int prepared = sqlite3_prepare_v2(db, Utf8z(sql), -1, out stmt, IntPtr.Zero);
      if (prepared != SQLITE_OK) throw new Exception("sqlite prepare failed: " + Utf8String(sqlite3_errmsg(db)));

      byte[] symbolLike = Utf8z("%" + (symbol ?? "").ToUpperInvariant() + "%");
      int bound = sqlite3_bind_text(stmt, 1, symbolLike, symbolLike.Length - 1, new IntPtr(-1));
      if (bound != SQLITE_OK) throw new Exception("sqlite bind failed: " + bound);

      StringBuilder output = new StringBuilder();
      while (true) {
        int step = sqlite3_step(stmt);
        if (step == SQLITE_DONE) break;
        if (step != SQLITE_ROW) throw new Exception("sqlite step failed: " + step);

        output.Append(Base64(Utf8String(sqlite3_column_text(stmt, 0)))).Append('\\t');
        output.Append(Base64(Utf8String(sqlite3_column_text(stmt, 1)))).Append('\\t');
        output.Append(Base64(Utf8String(sqlite3_column_text(stmt, 2)))).Append('\\t');
        output.Append(sqlite3_column_int(stmt, 3)).Append('\\t');
        output.Append(sqlite3_column_double(stmt, 4).ToString(CultureInfo.InvariantCulture)).Append('\\t');
        output.Append(sqlite3_column_double(stmt, 5).ToString(CultureInfo.InvariantCulture)).Append('\\t');
        output.Append(sqlite3_column_double(stmt, 6).ToString(CultureInfo.InvariantCulture)).Append('\\t');
        output.Append(sqlite3_column_double(stmt, 7).ToString(CultureInfo.InvariantCulture)).Append('\\n');
      }
      return output.ToString();
    } finally {
      if (stmt != IntPtr.Zero) sqlite3_finalize(stmt);
      sqlite3_close(db);
    }
  }
}
"@
Add-Type $source
[TradeToolsVatagaLayoutSqlite]::Query($dbPath, $symbol)
`

const normalizeSymbolText = (value: string): string => value.replace(/[^a-z0-9]/gi, '').toUpperCase()

const symbolBase = (symbol: string): string => (
  normalizeSymbolText(symbol).replace(/(USDT|USDC|FDUSD|BUSD|USD|BTC|ETH|TRY|EUR|RUB)$/, '')
)

const scoreRow = (symbol: string, row: VatagaLayoutRow): number => {
  const normalizedSymbol = normalizeSymbolText(symbol)
  const base = symbolBase(symbol)
  const tabTitle = normalizeSymbolText(row.tabTitle)
  let score = 10

  if (tabTitle && tabTitle === normalizedSymbol) score += 120
  if (base && tabTitle === base) score += 100
  if (row.isActive) score += 120

  return score
}

const isValidRow = (row: VatagaLayoutRow): boolean => (
  Boolean(row.workspaceId) &&
  [row.x, row.y, row.width, row.height].every((value) => Number.isFinite(value)) &&
  row.width > 0 &&
  row.height > 0
)

export const selectBestVatagaLayoutMatch = (symbol: string, rows: VatagaLayoutRow[]): VatagaLayoutMatch | undefined => {
  const bestByWorkspace = new Map<string, { row: VatagaLayoutRow, score: number }>()

  for (const row of rows) {
    if (!isValidRow(row)) continue
    const score = scoreRow(symbol, row)
    const current = bestByWorkspace.get(row.workspaceId)
    if (!current || score > current.score) bestByWorkspace.set(row.workspaceId, { row, score })
  }

  const ranked = [...bestByWorkspace.values()].sort((left, right) => right.score - left.score)
  const best = ranked[0]
  if (!best || ranked[1]?.score === best.score) return undefined

  return {
    workspaceId: best.row.workspaceId,
    workspaceTitle: best.row.workspaceTitle,
    tabTitle: best.row.tabTitle,
    bounds: {
      x: best.row.x,
      y: best.row.y,
      width: best.row.width,
      height: best.row.height
    }
  }
}

const utf16Base64 = (value: string): string => Buffer.from(value, 'utf16le').toString('base64')

const findVatagaInstallDir = (env: NodeJS.ProcessEnv): string | undefined => {
  const candidates = [
    env.ProgramFiles ? join(env.ProgramFiles, 'Vataga', 'Vataga.terminal') : '',
    env['ProgramFiles(x86)'] ? join(env['ProgramFiles(x86)'], 'Vataga', 'Vataga.terminal') : '',
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Programs', 'Vataga', 'Vataga.terminal') : ''
  ].filter(Boolean)

  return candidates.find((candidate) => existsSync(join(candidate, 'runtimes', 'win-x64', 'native', 'e_sqlite3.dll')))
}

const decodeBase64Utf8 = (value: string): string => Buffer.from(value, 'base64').toString('utf8')

const decodeRows = (stdout: string): VatagaLayoutRow[] => stdout
  .split(/\r?\n/)
  .flatMap((line) => {
    if (!line.trim()) return []
    const [workspaceId, workspaceTitle, tabTitle, isActive, x, y, width, height] = line.split('\t')
    if ([workspaceId, workspaceTitle, tabTitle, isActive, x, y, width, height].some((value) => value === undefined)) return []

    const row: VatagaLayoutRow = {
      workspaceId: decodeBase64Utf8(workspaceId),
      workspaceTitle: decodeBase64Utf8(workspaceTitle),
      tabTitle: decodeBase64Utf8(tabTitle),
      isActive: isActive === '1',
      x: Number(x),
      y: Number(y),
      width: Number(width),
      height: Number(height)
    }

    return isValidRow(row) ? [row] : []
  })

export const resolveVatagaLayoutMatch = (
  symbol: string,
  env: NodeJS.ProcessEnv = process.env
): VatagaLayoutMatch | undefined => {
  if (process.platform !== 'win32') return undefined
  const appData = env.APPDATA
  const installDir = findVatagaInstallDir(env)
  if (!appData || !installDir) return undefined

  const layoutDbPath = join(appData, 'Vataga', 'Vataga.terminal', 'Settings', 'layout.db')
  if (!existsSync(layoutDbPath)) return undefined

  try {
    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      vatagaLayoutReaderScript,
      utf16Base64(installDir),
      utf16Base64(layoutDbPath),
      utf16Base64(normalizeSymbolText(symbol))
    ], {
      encoding: 'utf8',
      timeout: 3_000,
      windowsHide: true
    })
    if (result.status !== 0 || !result.stdout.trim()) return undefined

    return selectBestVatagaLayoutMatch(symbol, decodeRows(result.stdout))
  } catch {
    return undefined
  }
}
