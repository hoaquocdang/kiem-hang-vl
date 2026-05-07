$ErrorActionPreference = "Stop"
$env:PYTHONUTF8 = "1"
$env:PIP_NO_COLOR = "1"

$pythonCandidates = @(
    "C:\Users\ASUS\AppData\Local\Python\pythoncore-3.14-64\python.exe",
    "C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
)

foreach ($candidate in $pythonCandidates) {
    if (-not (Test-Path $candidate)) {
        continue
    }

    & $candidate -c "import tkinter" 2>$null
    if ($LASTEXITCODE -eq 0) {
        $python = $candidate
        break
    }
}

if (-not $python) {
    throw "Khong tim thay Python co Tkinter de build desktop app."
}

$buildVenv = ".build-venv"

if (Test-Path $buildVenv) {
    Remove-Item -LiteralPath $buildVenv -Recurse -Force
}

& $python -m venv $buildVenv
if ($LASTEXITCODE -ne 0) {
    throw "Khong tao duoc moi truong build."
}

$venvPython = Join-Path $buildVenv "Scripts\python.exe"

& $venvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) {
    throw "Khong nang cap duoc pip."
}

& $venvPython -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) {
    throw "Khong cai duoc dependencies trong requirements.txt."
}

& $venvPython -m pip install --pre pyinstaller
if ($LASTEXITCODE -ne 0) {
    throw "Khong cai duoc PyInstaller."
}

$prevPref = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& $venvPython -m PyInstaller `
  --noconfirm `
  --clean `
  --windowed `
  --name "Stock Audit App" `
  --onedir `
  --add-data "public;public" `
  --add-data "app;app" `
  desktop_launcher.py
$pyiExit = $LASTEXITCODE
$ErrorActionPreference = $prevPref

if ($pyiExit -ne 0) {
    throw "Build desktop app that bai (exit=$pyiExit)."
}

$distDir = Join-Path "dist" "Stock Audit App"
$localAccountSheet = Join-Path $env:LOCALAPPDATA "StockAuditApp\accounts.xlsx"
$distAccountSheet = Join-Path $distDir "accounts.xlsx"
if (Test-Path -LiteralPath $localAccountSheet) {
    Copy-Item -LiteralPath $localAccountSheet -Destination $distAccountSheet -Force
}
$localAccountSheetUrl = Join-Path $env:LOCALAPPDATA "StockAuditApp\account-sheet-url.txt"
$distAccountSheetUrl = Join-Path $distDir "account-sheet-url.txt"
if (Test-Path -LiteralPath $localAccountSheetUrl) {
    Copy-Item -LiteralPath $localAccountSheetUrl -Destination $distAccountSheetUrl -Force
}

$guidePath = Join-Path $distDir "HUONG_DAN_CHAY_OFFLINE.txt"
$zipPath = Join-Path "dist" "Stock Audit App Offline.zip"

@"
HUONG DAN CHAY STOCK AUDIT APP OFFLINE

1. Giai nen toan bo thu muc "Stock Audit App".
2. Mo file "Stock Audit App.exe".
3. Neu dung Vercel cloud co DB, khong can mo file .exe. Chi de cua so nay mo khi mo Vercel voi ?bridge=1 de ket noi local bridge 127.0.0.1:8020.
4. May user chi dang nhap bang tai khoan do admin cap, khong duoc tao admin moi.
5. Admin tao them user trong muc "Tai khoan" tren may quan ly.
6. Moi user co du lieu kiem hang rieng, khong anh huong user khac.
7. Admin co the reset mat khau, khoa/mo khoa hoac xoa user khi can.
8. Danh sach tai khoan duoc dong bo ra file LOCALAPPDATA\StockAuditApp\accounts.xlsx.
9. Neu chua vao duoc app admin, admin co the sua accounts.xlsx: them user moi, dien password tam thoi, luu file roi mo lai app.
10. Khi gui cho user, giu file accounts.xlsx nam canh Stock Audit App.exe. Neu cap nhat tai khoan, gui lai file accounts.xlsx moi de user thay vao thu muc app.
11. Neu dung Google Sheet, dat link CSV/export vao account-sheet-url.txt nam canh Stock Audit App.exe. Khi co internet, app se cap nhat user tu link nay; khi mat mang app dung cache local lan gan nhat.

Luu y:
- App chay local tren may tinh, khong can Internet.
- Khong doi ten hoac tach rieng file .exe khoi thu muc nay.
- DB tai khoan nam trong LOCALAPPDATA\StockAuditApp\stock_audit.db.
- Sheet tai khoan nam trong LOCALAPPDATA\StockAuditApp\accounts.xlsx.
- Ban sheet gui kem app nam canh Stock Audit App.exe va se duoc app nap vao LOCALAPPDATA khi chay.
- Neu co account-sheet-url.txt, app se uu tien sync user tu Google Sheet khi co mang.
- DB kiem hang tung user nam trong LOCALAPPDATA\StockAuditApp\users\user_<id>.db.
- Vercel cloud co DB se ghi du lieu tren server. Local bridge chi dung khi mo Vercel voi ?bridge=1 hoac can ghi DB local tren may tinh nay.
- Ban dong goi nay danh cho Windows 64-bit.
"@ | Set-Content -LiteralPath $guidePath -Encoding UTF8

if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -LiteralPath $distDir -DestinationPath $zipPath -Force

Write-Host "Da build xong tai thu muc dist\Stock Audit App"
Write-Host "Da dong goi zip tai dist\Stock Audit App Offline.zip"
