import {getAuthClient, accountRequest} from './account-client.js';
import {setupSupportForms} from './support-forms.js';

const contactForm = document.getElementById('contactForm');
const form = contactForm || document.getElementById('feedbackForm');
const submit = form.querySelector('button[type="submit"]');
const status = document.getElementById('supportAuth');
let session = null;

setupSupportForms({request: accountRequest, isSignedIn: () => Boolean(session)});

function updateSession(next) {
  const userChanged = session?.user.id !== next?.user.id;
  session = next;
  if (userChanged) {
    form.reset();
    form.querySelector('textarea').dispatchEvent(new Event('input'));
    document.getElementById(contactForm ? 'contactStatus' : 'feedbackStatus').textContent = '';
    if (session && contactForm) {
      document.getElementById('contactEmail').value = session.user.email || '';
      const metadata = session.user.user_metadata || {};
      document.getElementById('contactName').value = metadata.full_name || metadata.name || '';
    }
  }

  submit.disabled = !session || form.getAttribute('aria-busy') === 'true';
  if (session) {
    status.textContent = '';
    return;
  }
  const link = document.createElement('a');
  link.href = '/account.html?' + new URLSearchParams({returnTo: contactForm ? '/contact.html' : '/feedback.html'});
  link.textContent = 'Sign in';
  status.replaceChildren(link, contactForm ? ' to send your message.' : ' to submit feedback.');
}

try {
  const client = await getAuthClient();
  const {data, error} = await client.auth.getSession();
  if (error) throw error;
  updateSession(data.session);
  client.auth.onAuthStateChange((_event, next) => updateSession(next));
} catch {
  updateSession(null);
}
