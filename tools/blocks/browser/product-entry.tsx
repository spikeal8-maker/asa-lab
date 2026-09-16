import { createRoot } from 'react-dom/client';
import { BlocksEditor } from '../../../apps/web/src/blocks/BlocksEditor';
import { useEditorAvatar } from '../../../apps/web/src/components/editor-chrome/EditorAvatar';

// Browser harness uses the shipping parent component and the shipping avatar hook.
// Only the account HTTP response is a deterministic fixture, not a product substitute.
const user = {
  id: '33333333-3333-4333-8333-333333333333',
  displayName: 'Scratch acceptance account',
  email: 'scratch-acceptance@example.test',
};
function ProductFixture() {
  const avatar = useEditorAvatar(user);
  return (
    <BlocksEditor
      projectId="11111111-1111-4111-8111-111111111111"
      onBack={() => {
        window.location.hash = '/projects';
      }}
      onHomeClick={() => {
        window.location.hash = '/home';
      }}
      accountLabel={user.displayName}
      accountInitials={avatar.text}
      avatarUrl={avatar.src}
      onAccountClick={() => {
        window.location.hash = '/account';
      }}
    />
  );
}
const root = document.getElementById('product-root');
if (!root) throw new Error('Product fixture root missing');
createRoot(root).render(<ProductFixture />);
