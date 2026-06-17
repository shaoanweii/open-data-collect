export function formatDateTime(value?: string | number) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  const yyyy = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());

  if (hh === "00" && mm === "00" && ss === "00") {
    return `${yyyy}-${MM}-${dd}`;
  }

  return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}`;
}

export function formatDate(value?: string | number) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .replaceAll("/", "-");
}

export function formatCount(value?: string | number) {
  if (value === undefined || value === null || value === "") {
    return "0";
  }
  return String(value);
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
