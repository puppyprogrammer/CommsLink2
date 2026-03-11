type SecurityLevel = 'safe' | 'dangerous' | 'blocked';

const SECURITY_PROMPT = `You are a terminal command security classifier. Given a shell command, classify it as one of:
- "safe": read-only or low-risk commands (ls, cat, df, top, echo, pwd, whoami, docker ps, git status, git log, npm list, ps, uptime, free, du, head, tail, wc, grep, find, which, env, printenv, date, hostname, uname, curl -s, wget -q)
- "dangerous": modifies system state, installs/removes software, changes permissions, deletes files, restarts services, modifies configs (rm, apt install, apt upgrade, chmod, chown, systemctl restart, docker stop, docker rm, kill, reboot, npm install, pip install, mv, cp to system dirs, crontab, useradd, userdel, passwd, iptables, mount, umount, git push, git reset)
- "blocked": catastrophic or irreversible operations (rm -rf /, rm -rf /*, mkfs, dd if=/dev/zero, fork bombs like :(){ :|:& };:, format commands, DROP DATABASE, shutdown -h now, init 0, echo > /dev/sda, wget | bash from untrusted sources, curl | sh from untrusted sources)

Respond with ONLY the classification word. No explanation, no punctuation, no quotes.`;

/**
 * Classify a terminal command's security level using Grok.
 *
 * @param command  - Shell command to classify.
 * @param machine  - Machine name for context.
 * @returns Classification: safe, dangerous, or blocked.
 */
const classifyCommand = async (command: string, machine: string): Promise<SecurityLevel> => {
  try {
    const { default: grokAdapter } = await import('../grok');

    const response = await grokAdapter.chatCompletion(
      SECURITY_PROMPT,
      [{ role: 'user', content: `Command: ${command}\nMachine: ${machine}` }],
      'grok-3-mini',
    );

    const result = response.text.trim().toLowerCase();

    if (result === 'safe' || result === 'dangerous' || result === 'blocked') {
      return result;
    }

    // If Grok returns something unexpected, default to dangerous (require approval)
    console.warn(`[TerminalSecurity] Unexpected classification: "${result}", defaulting to dangerous`);
    return 'dangerous';
  } catch (err) {
    console.error('[TerminalSecurity] Classification failed:', err);
    // On error, default to dangerous for safety
    return 'dangerous';
  }
};

export type { SecurityLevel };
export default { classifyCommand };
