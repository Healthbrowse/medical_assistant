// Older support links identified the form by its fragment.
function openBookmarkedForm() {
  if (location.hash === '#feedback') location.replace('/feedback.html');
  if (location.hash === '#contact') location.replace('/contact.html');
}
openBookmarkedForm();
window.addEventListener('hashchange', openBookmarkedForm);
