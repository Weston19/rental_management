const validateEmail = (email) => {
  if (!email || email.trim() === '') {
    return { valid: false, message: 'Email is required' };
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { valid: false, message: 'Please enter a valid email address' };
  }
  return { valid: true };
};

const validatePassword = (password) => {
  if (!password) {
    return { valid: false, message: 'Password is required' };
  }
  if (password.length < 6) {
    return { valid: false, message: 'Password must be at least 6 characters long' };
  }
  return { valid: true };
};

const validatePhoneNumber = (phone) => {
  if (!phone || phone.trim() === '') {
    return { valid: false, message: 'Phone number is required' };
  }
  const kenyanPhoneRegex = /^(?:\+254|0)?7[0-9]{8}$/;
  if (!kenyanPhoneRegex.test(phone.replace(/\s+/g, ''))) {
    return { valid: false, message: 'Please enter a valid Kenyan phone number (e.g., 07XXXXXXXX or +2547XXXXXXXX)' };
  }
  return { valid: true };
};

const validateAmount = (amount, fieldName = 'Amount') => {
  const num = parseFloat(amount);
  if (isNaN(num) || num <= 0) {
    return { valid: false, message: `${fieldName} must be a positive number` };
  }
  return { valid: true };
};

const validateRequired = (value, fieldName) => {
  if (!value || (typeof value === 'string' && value.trim() === '')) {
    return { valid: false, message: `${fieldName} is required` };
  }
  return { valid: true };
};

const validateAdminSignup = (req, res, next) => {
  const { email, password, company_name } = req.body;
  
  const emailCheck = validateEmail(email);
  if (!emailCheck.valid) {
    return res.status(400).json({ error: emailCheck.message });
  }
  
  const passwordCheck = validatePassword(password);
  if (!passwordCheck.valid) {
    return res.status(400).json({ error: passwordCheck.message });
  }
  
  const companyCheck = validateRequired(company_name, 'Company name');
  if (!companyCheck.valid) {
    return res.status(400).json({ error: companyCheck.message });
  }
  
  next();
};

const validateAdminLogin = (req, res, next) => {
  const { email, password } = req.body;
  
  const emailCheck = validateEmail(email);
  if (!emailCheck.valid) {
    return res.status(400).json({ error: emailCheck.message });
  }
  
  if (!password) {
    return res.status(400).json({ error: 'Password is required' });
  }
  
  next();
};

const validateTenantSignup = (req, res, next) => {
  const { phone, password } = req.body;
  
  const phoneCheck = validatePhoneNumber(phone);
  if (!phoneCheck.valid) {
    return res.status(400).json({ error: phoneCheck.message });
  }
  
  const passwordCheck = validatePassword(password);
  if (!passwordCheck.valid) {
    return res.status(400).json({ error: passwordCheck.message });
  }
  
  next();
};

const validateTenantLogin = (req, res, next) => {
  const { phone, password } = req.body;
  
  const phoneCheck = validatePhoneNumber(phone);
  if (!phoneCheck.valid) {
    return res.status(400).json({ error: phoneCheck.message });
  }
  
  if (!password) {
    return res.status(400).json({ error: 'Password is required' });
  }
  
  next();
};

const validatePayment = (req, res, next) => {
  const { amount, phone_number } = req.body;
  
  const amountCheck = validateAmount(amount, 'Payment amount');
  if (!amountCheck.valid) {
    return res.status(400).json({ error: amountCheck.message });
  }
  
  const phoneCheck = validatePhoneNumber(phone_number);
  if (!phoneCheck.valid) {
    return res.status(400).json({ error: phoneCheck.message });
  }
  
  next();
};

module.exports = {
  validateEmail,
  validatePassword,
  validatePhoneNumber,
  validateAmount,
  validateRequired,
  validateAdminSignup,
  validateAdminLogin,
  validateTenantSignup,
  validateTenantLogin,
  validatePayment
};
