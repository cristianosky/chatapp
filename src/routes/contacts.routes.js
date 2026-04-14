const router = require('express').Router();
const { listContacts, addContact, removeContact } = require('../controllers/contacts.controller');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.get   ('/',             listContacts);
router.post  ('/',             addContact);
router.delete('/:contactId',   removeContact);

module.exports = router;
