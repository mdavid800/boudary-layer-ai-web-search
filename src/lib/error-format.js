export function formatErrorWithCause(error) {
  const message = error?.message || String(error);
  const causeMessage = formatCause(error?.cause);

  if (!causeMessage) {
    return message;
  }

  return `${message} (cause: ${causeMessage})`;
}

function formatCause(cause) {
  if (!cause) {
    return '';
  }

  const parts = [cause.code, cause.message].filter(Boolean);

  if (parts.length > 0) {
    return parts.join(' - ');
  }

  return String(cause);
}
