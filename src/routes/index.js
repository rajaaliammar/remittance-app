import express from 'express';
import authRoutes from './auth.routes.js';
import accountsRoutes from './accounts.routes.js';
import userRoutes from './user.routes.js';
import backofficeUserRoutes from './backofficeUser.routes.js';
import customerRoutes from './customer.routes.js';
import agentRoutes from './agent.routes.js';
import roleRoutes from './role.routes.js';
import continentRoutes from './continent.routes.js';
import countryRoutes from './country.routes.js';
import countryServiceRoutes from './countryService.routes.js';
import countryChargeRoutes from './countryCharge.routes.js';
import stateRoutes from './state.routes.js';
import serviceRoutes from './service.routes.js';
import purposeRoutes from './purpose.routes.js';
import sourceOfFundRoutes from './sourceOfFund.routes.js';
import employmentStatusRoutes from './employmentStatus.routes.js';
import remittanceBankRoutes from './remittanceBank.routes.js';
import remittanceWalletRoutes from './remittanceWallet.routes.js';
import remittanceBankGiftRoutes from './remittanceBankGift.routes.js';
import pageRoutes from './page.routes.js';
import manageContentRoutes from './manageContent.routes.js';
import blogCategoryRoutes from './blogCategory.routes.js';
import blogRoutes from './blog.routes.js';
import menuRoutes from './menu.routes.js';
import paymentGatewayRoutes from './paymentGateway.routes.js';
import manualGatewayRoutes from './manualGateway.routes.js';
import remittanceTransactionRoutes from './remittanceTransaction.routes.js';
import levelRoutes from './level.routes.js';
import registrationSettingRoutes from './registrationSetting.routes.js';
import receiptSettingRoutes from './receiptSetting.routes.js';
import kycRoutes from './kyc.routes.js';
import messageRoutes from './message.routes.js';
import faqRoutes from './faq.routes.js';
import taxFeeRoutes from './taxFee.routes.js';
import addressRoutes from './address.routes.js';
import stateDisclosureRoutes from './stateDisclosure.routes.js';
import orchestrationRoutes from './orchestration.routes.js';
import accountingRoutes from './accounting.routes.js';
import uploadRoutes from './upload.routes.js';
import complianceRoutes from './compliance.routes.js';
import acceptblueRoutes from './acceptblue.routes.js';

const router = express.Router();

// Mobile app compatibility: /api/auth/login, /api/accounts/signup
router.use('/auth', authRoutes);
router.use('/accounts', accountsRoutes);

// Mount route modules
router.use('/users', userRoutes);
router.use('/backoffice-users', backofficeUserRoutes);
router.use('/customers', customerRoutes);
router.use('/agents', agentRoutes);
router.use('/roles', roleRoutes);
router.use('/continents', continentRoutes);
router.use('/countries', countryRoutes);
router.use('/country-services', countryServiceRoutes);
router.use('/country-charges', countryChargeRoutes);
router.use('/states', stateRoutes);
router.use('/services', serviceRoutes);
router.use('/purposes', purposeRoutes);
router.use('/source-of-funds', sourceOfFundRoutes);
router.use('/employment-statuses', employmentStatusRoutes);
router.use('/remittance-banks', remittanceBankRoutes);
router.use('/remittance-wallets', remittanceWalletRoutes);
router.use('/', remittanceBankGiftRoutes);
router.use('/pages', pageRoutes);
router.use('/manage-content', manageContentRoutes);
router.use('/blog-categories', blogCategoryRoutes);
router.use('/blogs', blogRoutes);
router.use('/menus', menuRoutes);
router.use('/payment-gateways', paymentGatewayRoutes);
router.use('/manual-gateways', manualGatewayRoutes);
router.use('/remittance-transactions', remittanceTransactionRoutes);
router.use('/levels', levelRoutes);
router.use('/registration-setting', registrationSettingRoutes);
router.use('/receipt-settings', receiptSettingRoutes);
router.use('/kyc', kycRoutes);
router.use('/messages', messageRoutes);
router.use('/faqs', faqRoutes);
router.use('/tax-fees', taxFeeRoutes);
router.use('/address', addressRoutes);
router.use('/state-disclosures', stateDisclosureRoutes);
router.use('/orchestration', orchestrationRoutes);
router.use('/accounting', accountingRoutes);
router.use('/upload', uploadRoutes);
router.use('/compliance', complianceRoutes);
router.use('/acceptblue', acceptblueRoutes);

// Default route
router.get('/', (req, res) => {
  res.json({ 
    message: 'Remittance API',
    version: '1.0.0',
    endpoints: {
      users: '/api/users',
      backofficeUsers: '/api/backoffice-users',
      customers: '/api/customers',
      agents: '/api/agents',
      roles: '/api/roles',
      continents: '/api/continents',
      countries: '/api/countries',
      countryServices: '/api/country-services',
      countryCharges: '/api/country-charges',
      states: '/api/states',
      services: '/api/services',
      purposes: '/api/purposes',
      sourceOfFunds: '/api/source-of-funds',
      remittanceBanks: '/api/remittance-banks',
      remittanceWallets: '/api/remittance-wallets',
      pages: '/api/pages',
      manageContent: '/api/manage-content',
      blogCategories: '/api/blog-categories',
      blogs: '/api/blogs',
      menus: '/api/menus',
      levels: '/api/levels'
    }
  });
});

export default router;

