import prisma from '../utils/prisma.js';

/**
 * Helper function to convert raw database results to proper boolean values
 * PostgreSQL might return booleans as strings or other types
 */
const normalizeSettings = (raw) => {
  if (!raw) return null;
  return {
    id: raw.id,
    phoneNumber: Boolean(raw.phoneNumber === true || raw.phoneNumber === 'true' || raw.phoneNumber === 1),
    phoneNumberRequired: Boolean(raw.phoneNumberRequired === true || raw.phoneNumberRequired === 'true' || raw.phoneNumberRequired === 1),
    emailAddress: Boolean(raw.emailAddress === true || raw.emailAddress === 'true' || raw.emailAddress === 1),
    emailAddressRequired: Boolean(raw.emailAddressRequired === true || raw.emailAddressRequired === 'true' || raw.emailAddressRequired === 1),
    fullName: Boolean(raw.fullName === true || raw.fullName === 'true' || raw.fullName === 1),
    fullNameRequired: Boolean(raw.fullNameRequired === true || raw.fullNameRequired === 'true' || raw.fullNameRequired === 1),
    dateOfBirth: Boolean(raw.dateOfBirth === true || raw.dateOfBirth === 'true' || raw.dateOfBirth === 1),
    dateOfBirthRequired: Boolean(raw.dateOfBirthRequired === true || raw.dateOfBirthRequired === 'true' || raw.dateOfBirthRequired === 1),
    gender: Boolean(raw.gender === true || raw.gender === 'true' || raw.gender === 1),
    genderRequired: Boolean(raw.genderRequired === true || raw.genderRequired === 'true' || raw.genderRequired === 1),
    nationality: Boolean(raw.nationality === true || raw.nationality === 'true' || raw.nationality === 1),
    nationalityRequired: Boolean(raw.nationalityRequired === true || raw.nationalityRequired === 'true' || raw.nationalityRequired === 1),
    country: Boolean(raw.country === true || raw.country === 'true' || raw.country === 1),
    countryRequired: Boolean(raw.countryRequired === true || raw.countryRequired === 'true' || raw.countryRequired === 1),
    regionState: Boolean(raw.regionState === true || raw.regionState === 'true' || raw.regionState === 1),
    regionStateRequired: Boolean(raw.regionStateRequired === true || raw.regionStateRequired === 'true' || raw.regionStateRequired === 1),
    woredaDistrict: Boolean(raw.woredaDistrict === true || raw.woredaDistrict === 'true' || raw.woredaDistrict === 1),
    woredaDistrictRequired: Boolean(raw.woredaDistrictRequired === true || raw.woredaDistrictRequired === 'true' || raw.woredaDistrictRequired === 1),
    city: Boolean(raw.city === true || raw.city === 'true' || raw.city === 1),
    cityRequired: Boolean(raw.cityRequired === true || raw.cityRequired === 'true' || raw.cityRequired === 1),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
};

/**
 * Get user registration settings
 * Returns the current registration field settings
 */
export const getUserRegistrationSettings = async (req, res) => {
  try {
    // Get the first (and only) registration setting record
    // If none exists, create default settings
    // Use raw query as fallback if Prisma client not regenerated
    let settings;
    try {
      settings = await prisma.registrationSetting.findFirst();
    } catch (error) {
      // If Prisma client doesn't have the model yet, use raw query
      if (error.message.includes('registrationSetting') || error.message.includes('undefined')) {
        const rawSettings = await prisma.$queryRawUnsafe(`
          SELECT * FROM "registration_settings" LIMIT 1
        `);
        if (rawSettings && rawSettings.length > 0) {
          settings = normalizeSettings(rawSettings[0]);
        } else {
          settings = null;
        }
      } else {
        throw error;
      }
    }

    if (!settings) {
      // Create default settings
      try {
        settings = await prisma.registrationSetting.create({
          data: {
            phoneNumber: true,
            phoneNumberRequired: true,
            emailAddress: true,
            emailAddressRequired: false,
            fullName: true,
            fullNameRequired: true,
            dateOfBirth: false,
            dateOfBirthRequired: false,
            gender: false,
            genderRequired: false,
            nationality: false,
            nationalityRequired: false,
            country: false,
            countryRequired: false,
            regionState: false,
            regionStateRequired: false,
            woredaDistrict: false,
            woredaDistrictRequired: false,
            city: false,
            cityRequired: false,
          },
        });
      } catch (error) {
        // Fallback to raw query if Prisma client not regenerated
        if (error.message.includes('registrationSetting') || error.message.includes('undefined')) {
          const crypto = await import('crypto');
          const id = crypto.randomUUID();
          const query = `
            INSERT INTO "registration_settings" (
              "id", "phoneNumber", "phoneNumberRequired", "emailAddress", "emailAddressRequired",
              "fullName", "fullNameRequired", "dateOfBirth", "dateOfBirthRequired",
              "gender", "genderRequired", "nationality", "nationalityRequired",
              "country", "countryRequired", "regionState", "regionStateRequired",
              "woredaDistrict", "woredaDistrictRequired", "city", "cityRequired",
              "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, $3, $4, $5,
              $6, $7, $8, $9,
              $10, $11, $12, $13,
              $14, $15, $16, $17,
              $18, $19, $20, $21,
              NOW(), NOW()
            )
          `;
          await prisma.$executeRawUnsafe(query,
            id, true, true, true, false,
            true, true, false, false,
            false, false, false, false,
            false, false, false, false,
            false, false, false, false
          );
          const rawSettings = await prisma.$queryRawUnsafe(
            `SELECT * FROM "registration_settings" WHERE "id" = $1`,
            id
          );
          if (rawSettings && rawSettings.length > 0) {
            settings = normalizeSettings(rawSettings[0]);
          } else {
            settings = null;
          }
        } else {
          throw error;
        }
      }
    }

    // Format response to match mobile app expectations
    const response = {
      success: true,
      data: {
        phoneNumber: settings.phoneNumber,
        phoneNumberRequired: settings.phoneNumberRequired,
        emailAddress: settings.emailAddress,
        emailAddressRequired: settings.emailAddressRequired,
        fullName: settings.fullName,
        fullNameRequired: settings.fullNameRequired,
        dateOfBirth: settings.dateOfBirth,
        dateOfBirthRequired: settings.dateOfBirthRequired,
        gender: settings.gender,
        genderRequired: settings.genderRequired,
        nationality: settings.nationality,
        nationalityRequired: settings.nationalityRequired,
        country: settings.country,
        countryRequired: settings.countryRequired,
        regionState: settings.regionState,
        regionStateRequired: settings.regionStateRequired,
        woredaDistrict: settings.woredaDistrict,
        woredaDistrictRequired: settings.woredaDistrictRequired,
        city: settings.city,
        cityRequired: settings.cityRequired,
      },
    };

    res.json(response);
  } catch (error) {
    console.error('Error fetching registration settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch registration settings',
      error: error.message,
    });
  }
};

/**
 * Update user registration settings
 * Updates which fields are enabled/required during registration
 */
export const updateUserRegistrationSettings = async (req, res) => {
  try {
    const {
      phoneNumber,
      phoneNumberRequired,
      emailAddress,
      emailAddressRequired,
      fullName,
      fullNameRequired,
      dateOfBirth,
      dateOfBirthRequired,
      gender,
      genderRequired,
      nationality,
      nationalityRequired,
      country,
      countryRequired,
      regionState,
      regionStateRequired,
      woredaDistrict,
      woredaDistrictRequired,
      city,
      cityRequired,
    } = req.body;

    // Get existing settings or create new
    // Use raw query as fallback if Prisma client not regenerated
    let settings;
    try {
      settings = await prisma.registrationSetting.findFirst();
    } catch (error) {
      // If Prisma client doesn't have the model yet, use raw query
      if (error.message.includes('registrationSetting') || error.message.includes('undefined')) {
        const rawSettings = await prisma.$queryRawUnsafe(`
          SELECT * FROM "registration_settings" LIMIT 1
        `);
        if (rawSettings && rawSettings.length > 0) {
          settings = normalizeSettings(rawSettings[0]);
        } else {
          settings = null;
        }
      } else {
        throw error;
      }
    }

    const updateData = {};
    if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;
    if (phoneNumberRequired !== undefined) updateData.phoneNumberRequired = phoneNumberRequired;
    if (emailAddress !== undefined) updateData.emailAddress = emailAddress;
    if (emailAddressRequired !== undefined) updateData.emailAddressRequired = emailAddressRequired;
    if (fullName !== undefined) updateData.fullName = fullName;
    if (fullNameRequired !== undefined) updateData.fullNameRequired = fullNameRequired;
    if (dateOfBirth !== undefined) updateData.dateOfBirth = dateOfBirth;
    if (dateOfBirthRequired !== undefined) updateData.dateOfBirthRequired = dateOfBirthRequired;
    if (gender !== undefined) updateData.gender = gender;
    if (genderRequired !== undefined) updateData.genderRequired = genderRequired;
    if (nationality !== undefined) updateData.nationality = nationality;
    if (nationalityRequired !== undefined) updateData.nationalityRequired = nationalityRequired;
    if (country !== undefined) updateData.country = country;
    if (countryRequired !== undefined) updateData.countryRequired = countryRequired;
    if (regionState !== undefined) updateData.regionState = regionState;
    if (regionStateRequired !== undefined) updateData.regionStateRequired = regionStateRequired;
    if (woredaDistrict !== undefined) updateData.woredaDistrict = woredaDistrict;
    if (woredaDistrictRequired !== undefined) updateData.woredaDistrictRequired = woredaDistrictRequired;
    if (city !== undefined) updateData.city = city;
    if (cityRequired !== undefined) updateData.cityRequired = cityRequired;

    if (settings) {
      // Update existing settings
      try {
        settings = await prisma.registrationSetting.update({
          where: { id: settings.id },
          data: updateData,
        });
      } catch (error) {
        // Fallback to raw query if Prisma client not regenerated
        if (error.message.includes('registrationSetting') || error.message.includes('undefined')) {
          const setClauses = [];
          const values = [];
          let paramIndex = 1;
          
          Object.keys(updateData).forEach((key) => {
            setClauses.push(`"${key}" = $${paramIndex}`);
            values.push(updateData[key]);
            paramIndex++;
          });
          
          setClauses.push(`"updatedAt" = NOW()`);
          values.push(settings.id);
          
          // Build the query with proper parameter placeholders
          const query = `UPDATE "registration_settings" SET ${setClauses.join(', ')} WHERE "id" = $${paramIndex}`;
          await prisma.$executeRawUnsafe(query, ...values, settings.id);
          
          const rawSettings = await prisma.$queryRawUnsafe(
            `SELECT * FROM "registration_settings" WHERE "id" = $1`,
            settings.id
          );
          if (rawSettings && rawSettings.length > 0) {
            settings = normalizeSettings(rawSettings[0]);
          } else {
            settings = null;
          }
        } else {
          throw error;
        }
      }
    } else {
      // Create new settings with defaults
      try {
        settings = await prisma.registrationSetting.create({
          data: {
            phoneNumber: phoneNumber ?? true,
            phoneNumberRequired: phoneNumberRequired ?? true,
            emailAddress: emailAddress ?? true,
            emailAddressRequired: emailAddressRequired ?? false,
            fullName: fullName ?? true,
            fullNameRequired: fullNameRequired ?? true,
            dateOfBirth: dateOfBirth ?? false,
            dateOfBirthRequired: dateOfBirthRequired ?? false,
            gender: gender ?? false,
            genderRequired: genderRequired ?? false,
            nationality: nationality ?? false,
            nationalityRequired: nationalityRequired ?? false,
            country: country ?? false,
            countryRequired: countryRequired ?? false,
            regionState: regionState ?? false,
            regionStateRequired: regionStateRequired ?? false,
            woredaDistrict: woredaDistrict ?? false,
            woredaDistrictRequired: woredaDistrictRequired ?? false,
            city: city ?? false,
            cityRequired: cityRequired ?? false,
          },
        });
      } catch (error) {
        // Fallback to raw query if Prisma client not regenerated
        if (error.message.includes('registrationSetting') || error.message.includes('undefined')) {
          const crypto = await import('crypto');
          const id = crypto.randomUUID();
          const query = `
            INSERT INTO "registration_settings" (
              "id", "phoneNumber", "phoneNumberRequired", "emailAddress", "emailAddressRequired",
              "fullName", "fullNameRequired", "dateOfBirth", "dateOfBirthRequired",
              "gender", "genderRequired", "nationality", "nationalityRequired",
              "country", "countryRequired", "regionState", "regionStateRequired",
              "woredaDistrict", "woredaDistrictRequired", "city", "cityRequired",
              "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, $3, $4, $5,
              $6, $7, $8, $9,
              $10, $11, $12, $13,
              $14, $15, $16, $17,
              $18, $19, $20, $21,
              NOW(), NOW()
            )
          `;
          await prisma.$executeRawUnsafe(query,
            id,
            phoneNumber ?? true, phoneNumberRequired ?? true,
            emailAddress ?? true, emailAddressRequired ?? false,
            fullName ?? true, fullNameRequired ?? true,
            dateOfBirth ?? false, dateOfBirthRequired ?? false,
            gender ?? false, genderRequired ?? false,
            nationality ?? false, nationalityRequired ?? false,
            country ?? false, countryRequired ?? false,
            regionState ?? false, regionStateRequired ?? false,
            woredaDistrict ?? false, woredaDistrictRequired ?? false,
            city ?? false, cityRequired ?? false
          );
          
          const rawSettings = await prisma.$queryRawUnsafe(
            `SELECT * FROM "registration_settings" WHERE "id" = $1`,
            id
          );
          if (rawSettings && rawSettings.length > 0) {
            settings = normalizeSettings(rawSettings[0]);
          } else {
            settings = null;
          }
        } else {
          throw error;
        }
      }
    }

    res.json({
      success: true,
      message: 'Registration settings updated successfully',
      data: {
        phoneNumber: settings.phoneNumber,
        phoneNumberRequired: settings.phoneNumberRequired,
        emailAddress: settings.emailAddress,
        emailAddressRequired: settings.emailAddressRequired,
        fullName: settings.fullName,
        fullNameRequired: settings.fullNameRequired,
        dateOfBirth: settings.dateOfBirth,
        dateOfBirthRequired: settings.dateOfBirthRequired,
        gender: settings.gender,
        genderRequired: settings.genderRequired,
        nationality: settings.nationality,
        nationalityRequired: settings.nationalityRequired,
        country: settings.country,
        countryRequired: settings.countryRequired,
        regionState: settings.regionState,
        regionStateRequired: settings.regionStateRequired,
        woredaDistrict: settings.woredaDistrict,
        woredaDistrictRequired: settings.woredaDistrictRequired,
        city: settings.city,
        cityRequired: settings.cityRequired,
      },
    });
  } catch (error) {
    console.error('Error updating registration settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update registration settings',
      error: error.message,
    });
  }
};
