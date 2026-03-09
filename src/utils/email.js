import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

// Create transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Verify transporter configuration
transporter.verify((error, success) => {
  if (error) {
    console.error('Email transporter error:', error);
  } else {
    console.log('✅ Email server is ready to send messages');
  }
});

export const sendInvitationEmail = async (email, inviteToken, adminDetails = {}) => {
  const inviteUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/backoffice-user/complete-profile?token=${inviteToken}`;
  
  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Backoffice User Invitation</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .container {
          background-color: #f9f9f9;
          border-radius: 8px;
          padding: 30px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .header {
          text-align: center;
          margin-bottom: 30px;
        }
        .logo {
          font-size: 24px;
          font-weight: bold;
          color: #1890ff;
          margin-bottom: 10px;
        }
        .content {
          background-color: #ffffff;
          padding: 25px;
          border-radius: 6px;
          margin-bottom: 20px;
        }
        .button {
          display: inline-block;
          padding: 12px 30px;
          background-color: #1890ff;
          color: #ffffff !important;
          text-decoration: none;
          border-radius: 6px;
          font-weight: bold;
          text-align: center;
          margin: 20px 0;
        }
        .button:hover {
          background-color: #40a9ff;
        }
        .footer {
          text-align: center;
          color: #8c8c8c;
          font-size: 12px;
          margin-top: 20px;
        }
        .details {
          background-color: #f0f0f0;
          padding: 15px;
          border-radius: 4px;
          margin: 15px 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">BrandPay</div>
          <h2>Backoffice User Invitation</h2>
        </div>
        <div class="content">
          <p>Hello,</p>
          <p>You have been invited to join BrandPay as a backoffice user. Please complete your profile to get started.</p>
          
          ${adminDetails.firstName || adminDetails.lastName ? `
          <div class="details">
            <p><strong>Pre-filled Information:</strong></p>
            ${adminDetails.firstName ? `<p>First Name: ${adminDetails.firstName}</p>` : ''}
            ${adminDetails.lastName ? `<p>Last Name: ${adminDetails.lastName}</p>` : ''}
            ${adminDetails.phone ? `<p>Phone: ${adminDetails.phone}</p>` : ''}
            ${adminDetails.country ? `<p>Country: ${adminDetails.country}</p>` : ''}
          </div>
          ` : ''}
          
          <p>Click the button below to verify your email and complete your profile:</p>
          <div style="text-align: center;">
            <a href="${inviteUrl}" class="button">Verify and Complete Profile</a>
          </div>
          <p style="font-size: 12px; color: #8c8c8c; margin-top: 20px;">
            Or copy and paste this link into your browser:<br>
            <a href="${inviteUrl}" style="color: #1890ff;">${inviteUrl}</a>
          </p>
          <p style="font-size: 12px; color: #8c8c8c;">
            This invitation link will expire in 7 days.
          </p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} BrandPay. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const mailOptions = {
    from: `"BrandPay" <${process.env.SMTP_USER}>`,
    to: email,
    subject: 'Invitation to Join BrandPay Backoffice',
    html: emailHtml,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Invitation email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending invitation email:', error);
    throw error;
  }
};

export const sendAgentInvitationEmail = async (email, inviteToken, adminDetails = {}) => {
  const inviteUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/agent/onboarding?token=${inviteToken}`;
  
  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Agent Invitation</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .container {
          background-color: #f9f9f9;
          border-radius: 8px;
          padding: 30px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .header {
          text-align: center;
          margin-bottom: 30px;
        }
        .logo {
          font-size: 24px;
          font-weight: bold;
          color: #1890ff;
          margin-bottom: 10px;
        }
        .content {
          background-color: #ffffff;
          padding: 25px;
          border-radius: 6px;
          margin-bottom: 20px;
        }
        .button {
          display: inline-block;
          padding: 12px 30px;
          background-color: #1890ff;
          color: #ffffff !important;
          text-decoration: none;
          border-radius: 6px;
          font-weight: bold;
          text-align: center;
          margin: 20px 0;
        }
        .button:hover {
          background-color: #40a9ff;
        }
        .footer {
          text-align: center;
          color: #8c8c8c;
          font-size: 12px;
          margin-top: 20px;
        }
        .details {
          background-color: #f0f0f0;
          padding: 15px;
          border-radius: 4px;
          margin: 15px 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">BrandPay</div>
          <h2>Agent Invitation</h2>
        </div>
        <div class="content">
          <p>Hello${adminDetails.firstName ? ` ${adminDetails.firstName}` : ''},</p>
          <p>You have been invited to join BrandPay as an agent. Please complete your onboarding to get started.</p>
          
          ${adminDetails.firstName || adminDetails.lastName || adminDetails.businessName ? `
          <div class="details">
            <p><strong>Pre-filled Information:</strong></p>
            ${adminDetails.firstName ? `<p>First Name: ${adminDetails.firstName}</p>` : ''}
            ${adminDetails.lastName ? `<p>Last Name: ${adminDetails.lastName}</p>` : ''}
            ${adminDetails.businessName ? `<p>Business Name: ${adminDetails.businessName}</p>` : ''}
            ${adminDetails.phone ? `<p>Phone: ${adminDetails.phone}</p>` : ''}
            ${adminDetails.country ? `<p>Country: ${adminDetails.country}</p>` : ''}
            ${adminDetails.city ? `<p>City: ${adminDetails.city}</p>` : ''}
          </div>
          ` : ''}
          
          <p>Click the button below to complete your onboarding:</p>
          <div style="text-align: center;">
            <a href="${inviteUrl}" class="button">Complete Onboarding</a>
          </div>
          <p style="font-size: 12px; color: #8c8c8c; margin-top: 20px;">
            Or copy and paste this link into your browser:<br>
            <a href="${inviteUrl}" style="color: #1890ff;">${inviteUrl}</a>
          </p>
          <p style="font-size: 12px; color: #8c8c8c;">
            This invitation link will expire in 7 days.
          </p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} BrandPay. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const mailOptions = {
    from: `"BrandPay" <${process.env.SMTP_USER}>`,
    to: email,
    subject: 'Invitation to Join BrandPay as an Agent',
    html: emailHtml,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Agent invitation email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending agent invitation email:', error);
    throw error;
  }
};

export default transporter;

