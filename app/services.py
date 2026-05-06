from __future__ import annotations

import csv
from datetime import datetime
from io import BytesIO, StringIO
from pathlib import Path
from zipfile import BadZipFile

from fastapi import HTTPException, UploadFile
from openpyxl import load_workbook


MATRIX_REQUIRED_HEADERS = ["stt", "tên hàng", "tác nghiệp", "giá", "màu"]


def utc_now() -> str:
    return datetime.utcnow().isoformat(timespec="seconds")


def normalize_header(value: object) -> str:
    return str(value or "").strip().lower()


def normalize_text(value: object) -> str:
    return str(value or "").strip()


def normalize_quantity(value: object) -> int:
    text = normalize_text(value)
    if not text:
        return 0
    return int(float(text))


def parse_scan_code(scan_code: str) -> dict:
    normalized = normalize_text(scan_code).upper()
    if len(normalized) < 15:
        raise HTTPException(
            status_code=400,
            detail="Mã scan không hợp lệ. Cần ít nhất 15 ký tự theo quy tắc nhóm hàng.",
        )
    raw_size_code = normalized[7:9]
    year_code = normalized[9:12]
    operation_code = normalized[12:15]
    return {
        "raw_code": normalized,
        "color_code": normalized[3:7],
        "size_code": normalize_size_code(raw_size_code),
        "raw_size_code": raw_size_code,
        "year_code": year_code,
        "operation_code": operation_code,
        "operation_key": f"{int(year_code)}/{int(operation_code)}",
    }


async def parse_inventory_file(upload: UploadFile) -> list[dict]:
    filename = upload.filename or "inventory.xlsx"
    suffix = Path(filename).suffix.lower()
    content = await upload.read()

    if suffix == ".csv":
        return _parse_csv_matrix(content)
    if suffix in {".xlsx", ".xlsm"}:
        return _parse_excel_matrix(content)
    raise HTTPException(status_code=400, detail="Chỉ hỗ trợ file .xlsx, .xlsm hoặc .csv")


def _parse_csv_matrix(content: bytes) -> list[dict]:
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="Không đọc được file CSV UTF-8") from exc

    reader = csv.reader(StringIO(text))
    rows = list(reader)
    return _expand_matrix_rows(rows)


def _parse_excel_matrix(content: bytes) -> list[dict]:
    try:
        workbook = load_workbook(filename=BytesIO(content), data_only=True)
    except BadZipFile as exc:
        raise HTTPException(status_code=400, detail="File Excel không hợp lệ") from exc

    sheet = workbook.active
    rows = [list(row) for row in sheet.iter_rows(values_only=True)]
    return _expand_matrix_rows(rows)


def _expand_matrix_rows(rows: list[list[object]]) -> list[dict]:
    if not rows:
        raise HTTPException(status_code=400, detail="File không có dữ liệu")

    headers = [normalize_header(cell) for cell in rows[0]]
    _validate_matrix_headers(headers)
    size_columns = _collect_size_columns(headers)
    sale_column = _find_header_column(headers, "sale")
    if not size_columns:
        raise HTTPException(status_code=400, detail="Không tìm thấy cột size trong file")

    items: list[dict] = []
    for line_no, row in enumerate(rows[1:], start=2):
        if not any(normalize_text(cell) for cell in row):
            continue

        values = row + [None] * (len(headers) - len(row))
        product_name = normalize_text(values[1])
        operation_label = normalize_text(values[2])
        color_code = normalize_text(values[4]).upper()
        if not product_name or not color_code:
            continue

        for index, size_label in size_columns:
            try:
                stock_qty = normalize_quantity(values[index])
            except ValueError as exc:
                raise HTTPException(
                    status_code=400,
                    detail=f"Dòng {line_no}, cột {size_label} có số lượng không hợp lệ: {values[index]}",
                ) from exc
            if stock_qty <= 0:
                continue
            items.append(
                {
                    "variant_key": f"{color_code}-{size_label}",
                    "product_name": product_name,
                    "operation_label": operation_label,
                    "operation_code": extract_operation_code(operation_label),
                    "operation_key": normalize_operation_label(operation_label),
                    "color": color_code,
                    "size": size_label,
                    "stock_qty": stock_qty,
                    "price": normalize_text(values[3]),
                    "source_line": line_no,
                    "source_note": _build_source_note(values, sale_column),
                }
            )

    if not items:
        raise HTTPException(status_code=400, detail="File không có dòng tồn kho hợp lệ")
    return _merge_duplicate_items(items)


def _validate_matrix_headers(headers: list[str]) -> None:
    normalized_prefix = headers[:5]
    if normalized_prefix != MATRIX_REQUIRED_HEADERS:
        expected = ", ".join(MATRIX_REQUIRED_HEADERS)
        actual = ", ".join(normalized_prefix)
        raise HTTPException(
            status_code=400,
            detail=f"File chưa đúng mẫu. 5 cột đầu phải là: {expected}. Đang nhận: {actual}",
        )


def _collect_size_columns(headers: list[str]) -> list[tuple[int, str]]:
    ignored_labels = {"TỔNG", "TONG", "TOTAL", "SALE"}
    size_columns: list[tuple[int, str]] = []
    for index, header in enumerate(headers[5:], start=5):
        size_label = normalize_text(header).upper()
        if size_label and size_label not in ignored_labels:
            size_columns.append((index, size_label))
    return size_columns


def _find_header_column(headers: list[str], label: str) -> int | None:
    normalized_label = label.strip().lower()
    for index, header in enumerate(headers):
        if header == normalized_label:
            return index
    return None


def _build_source_note(values: list[object], sale_column: int | None) -> str:
    if sale_column is None or sale_column >= len(values):
        return ""
    sale_value = normalize_text(values[sale_column])
    if not sale_value:
        return ""
    return f"Hàng sale {sale_value}%"


def _merge_duplicate_items(items: list[dict]) -> list[dict]:
    merged: dict[tuple[str, str, str], dict] = {}
    for item in items:
        key = (item["product_name"], item["color"], item["size"], item["operation_key"])
        if key not in merged:
            merged[key] = item.copy()
            continue
        merged[key]["stock_qty"] += item["stock_qty"]
        note = item.get("source_note") or ""
        if note and note not in (merged[key].get("source_note") or ""):
            merged[key]["source_note"] = " | ".join(
                part for part in [merged[key].get("source_note") or "", note] if part
            )
    return list(merged.values())


def extract_operation_code(operation_label: str) -> str:
    suffix = operation_label.split("/")[-1].strip() if operation_label else ""
    digits = "".join(character for character in suffix if character.isdigit())
    return digits.zfill(3)[-3:] if digits else ""


def normalize_operation_label(operation_label: str) -> str:
    if not operation_label:
        return ""
    parts = [segment.strip() for segment in operation_label.split("/") if segment.strip()]
    if len(parts) != 2:
        return operation_label.strip()
    left_digits = "".join(character for character in parts[0] if character.isdigit())
    right_digits = "".join(character for character in parts[1] if character.isdigit())
    if not left_digits or not right_digits:
        return operation_label.strip()
    return f"{int(left_digits)}/{int(right_digits)}"


def normalize_size_code(size_code: str) -> str:
    cleaned = normalize_text(size_code).upper()
    if len(cleaned) == 2 and cleaned.startswith("0") and cleaned[1].isalpha():
        return cleaned[1]
    return cleaned
