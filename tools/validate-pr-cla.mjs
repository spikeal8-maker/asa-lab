#!/usr/bin/env node

// Only the repository owner is exempt: collaborators and organization members
// can hold independent copyright and therefore must accept the CLA themselves.
const trustedAssociations = new Set(['OWNER']);
const trustedBots = new Set(['dependabot[bot]', 'github-actions[bot]']);

const claAcceptancePattern = /^\s*-\s*\[[xX]\].*принимаю.*CLA\.md.*$/mu;
const rightsConfirmationPattern = /^\s*-\s*\[[xX]\].*имею право предоставить.*$/mu;

export function validateCla({ association = '', login = '', body = '' }) {
  const normalizedAssociation = association.trim().toUpperCase();
  const normalizedLogin = login.trim().toLowerCase();

  if (trustedAssociations.has(normalizedAssociation)) {
    return { ok: true, reason: `trusted repository association: ${normalizedAssociation}` };
  }

  if (trustedBots.has(normalizedLogin)) {
    return { ok: true, reason: `trusted automation account: ${normalizedLogin}` };
  }

  const missing = [];
  if (!claAcceptancePattern.test(body)) {
    missing.push('checked CLA.md acceptance');
  }
  if (!rightsConfirmationPattern.test(body)) {
    missing.push('checked rights and provenance confirmation');
  }

  if (missing.length > 0) {
    return { ok: false, reason: `missing ${missing.join(' and ')}` };
  }

  return { ok: true, reason: 'external contributor explicitly accepted the CLA' };
}

function runSelfTest() {
  const acceptedBody = `
- [x] Я прочитал(а) и принимаю [\`CLA.md\`](../CLA.md) версии 1.0.
- [X] Я имею право предоставить указанные лицензии.
`;

  const fixtures = [
    { name: 'owner without checkbox', input: { association: 'OWNER' }, expected: true },
    { name: 'trusted bot without checkbox', input: { login: 'dependabot[bot]' }, expected: true },
    {
      name: 'external author accepts',
      input: { association: 'NONE', body: acceptedBody },
      expected: true,
    },
    {
      name: 'external author leaves boxes empty',
      input: { association: 'NONE', body: '- [ ] CLA' },
      expected: false,
    },
  ];

  const failures = fixtures.filter(({ input, expected }) => validateCla(input).ok !== expected);
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`FAIL: CLA fixture ${failure.name}`);
    }
    process.exit(1);
  }

  console.log(`cla:check PASS (${fixtures.length} policy fixtures)`);
}

if (process.argv.includes('--self-test')) {
  runSelfTest();
} else {
  const result = validateCla({
    association: process.env.PR_AUTHOR_ASSOCIATION,
    login: process.env.PR_AUTHOR_LOGIN,
    body: process.env.PR_BODY,
  });

  if (!result.ok) {
    console.error(`CLA acceptance required: ${result.reason}.`);
    console.error(
      'Edit the Pull Request description and check both items in the "Права на вклад" section.',
    );
    process.exit(1);
  }

  console.log(`CLA acceptance PASS (${result.reason})`);
}
