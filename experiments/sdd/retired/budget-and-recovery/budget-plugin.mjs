import { execFileSync } from 'node:child_process';

// Uses the same ledger as external PRD/compile calls. No SDK dependency or
// model call; the hook runs before OpenCode executes the tool.
export const BudgetPlugin = async () => {
  const required = ['SDD_BUDGET_DB', 'SDD_BUDGET_POLICY', 'SDD_BUDGET_SCRIPT', 'SDD_PYTHON', 'SDD_STAGE', 'SDD_EXTERNAL_CALL'];
  for (const key of required) if (!process.env[key]) throw new Error(`Missing ${key}`);
  const dispatch = (request) => execFileSync(process.env.SDD_PYTHON, [process.env.SDD_BUDGET_SCRIPT,
    process.env.SDD_BUDGET_DB, process.env.SDD_BUDGET_POLICY,
    process.env.SDD_STAGE, JSON.stringify(request)], {stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
  return {
    'tool.execute.before': async (input, output) => {
      const request = {tool: input.tool, call: `${input.sessionID}:${input.callID}`,
        role: output.args?.subagent_type, background: output.args?.background,
        external: process.env.SDD_EXTERNAL_CALL};
      try {
        dispatch(request);
      } catch (error) {
        throw new Error(`SDD budget denied: ${error.stderr?.toString().trim() || error.message}`);
      }
    },
    'tool.execute.after': async (input) => {
      if (input.tool === 'task') dispatch({action: 'finished', call: `${input.sessionID}:${input.callID}`});
    },
  };
};
