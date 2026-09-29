type Level = 'info' | 'warn' | 'error';

function emit(level: Level, message: string, fields?: Record<string, unknown>) {
  const line = { ts: new Date().toISOString(), level, message, ...fields };
  const out = level === 'error' ? console.error : console.log;
  out(JSON.stringify(line));
}

export default {
  info: (message: string, fields?: Record<string, unknown>) => emit('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => emit('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => emit('error', message, fields),
};
