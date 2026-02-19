import prisma from '../utils/prisma.js';

/**
 * Get value from raw row - PostgreSQL raw queries may return lowercase or snake_case column names
 */
const toBool = (v) => Boolean(v === true || v === 'true' || v === 1 || v === 't');
const camelToSnake = (s) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const getRawBool = (raw, key) => {
  const v = raw[key] ?? raw[key.toLowerCase()] ?? raw[camelToSnake(key)];
  return toBool(v);
};

const normalizeSettings = (raw) => {
  if (!raw) return null;
  return {
    id: raw.id ?? raw.Id,
    phoneNumber: getRawBool(raw, 'phoneNumber'),
    phoneNumberRequired: getRawBool(raw, 'phoneNumberRequired'),
    emailAddress: getRawBool(raw, 'emailAddress'),
    emailAddressRequired: getRawBool(raw, 'emailAddressRequired'),
    fullName: getRawBool(raw, 'fullName'),
    fullNameRequired: getRawBool(raw, 'fullNameRequired'),
    middleName: getRawBool(raw, 'middleName'),
    middleNameRequired: getRawBool(raw, 'middleNameRequired'),
    telephone: getRawBool(raw, 'telephone'),
    telephoneRequired: getRawBool(raw, 'telephoneRequired'),
    unitApt: getRawBool(raw, 'unitApt'),
    unitAptRequired: getRawBool(raw, 'unitAptRequired'),
    zipCode: getRawBool(raw, 'zipCode'),
    zipCodeRequired: getRawBool(raw, 'zipCodeRequired'),
    dateOfBirth: getRawBool(raw, 'dateOfBirth'),
    dateOfBirthRequired: getRawBool(raw, 'dateOfBirthRequired'),
    gender: getRawBool(raw, 'gender'),
    genderRequired: getRawBool(raw, 'genderRequired'),
    nationality: getRawBool(raw, 'nationality'),
    nationalityRequired: getRawBool(raw, 'nationalityRequired'),
    placeOfBirth: getRawBool(raw, 'placeOfBirth'),
    placeOfBirthRequired: getRawBool(raw, 'placeOfBirthRequired'),
    occupation: getRawBool(raw, 'occupation'),
    occupationRequired: getRawBool(raw, 'occupationRequired'),
    sourceOfFund: getRawBool(raw, 'sourceOfFund'),
    sourceOfFundRequired: getRawBool(raw, 'sourceOfFundRequired'),
    residentCountry: getRawBool(raw, 'residentCountry'),
    residentCountryRequired: getRawBool(raw, 'residentCountryRequired'),
    country: getRawBool(raw, 'country'),
    countryRequired: getRawBool(raw, 'countryRequired'),
    regionState: getRawBool(raw, 'regionState'),
    regionStateRequired: getRawBool(raw, 'regionStateRequired'),
    woredaDistrict: getRawBool(raw, 'woredaDistrict'),
    woredaDistrictRequired: getRawBool(raw, 'woredaDistrictRequired'),
    city: getRawBool(raw, 'city'),
    cityRequired: getRawBool(raw, 'cityRequired'),
    createdAt: raw.createdAt ?? raw.createdat,
    updatedAt: raw.updatedAt ?? raw.updatedat,
  };
};

// Ensure newly added registration-setting columns exist in DB even if migrations/db push were not run yet.
const ensureRegistrationSettingColumns = async () => {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "registration_settings"
    ADD COLUMN IF NOT EXISTS "placeOfBirth" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "placeOfBirthRequired" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "occupation" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "occupationRequired" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "sourceOfFund" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "sourceOfFundRequired" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "residentCountry" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "residentCountryRequired" BOOLEAN NOT NULL DEFAULT false;
  `);
};

/**
 * Get user registration settings
 * Returns the current registration field settings
 */
export const getUserRegistrationSettings = async (req, res) => {
  try {
    await ensureRegistrationSettingColumns();

    // Read via raw SQL so newly added columns are returned even if Prisma client is stale.
    let settings = null;
    const rawSettings = await prisma.$queryRawUnsafe(`
      SELECT * FROM "registration_settings" LIMIT 1
    `);
    if (rawSettings && rawSettings.length > 0) {
      settings = normalizeSettings(rawSettings[0]);
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
            middleName: false,
            middleNameRequired: false,
            telephone: false,
            telephoneRequired: false,
            unitApt: false,
            unitAptRequired: false,
            zipCode: false,
            zipCodeRequired: false,
            dateOfBirth: false,
            dateOfBirthRequired: false,
            gender: false,
            genderRequired: false,
            nationality: false,
            nationalityRequired: false,
            placeOfBirth: false,
            placeOfBirthRequired: false,
            occupation: false,
            occupationRequired: false,
            sourceOfFund: false,
            sourceOfFundRequired: false,
            residentCountry: false,
            residentCountryRequired: false,
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
              "fullName", "fullNameRequired", "middleName", "middleNameRequired",
              "telephone", "telephoneRequired", "unitApt", "unitAptRequired",
              "zipCode", "zipCodeRequired", "dateOfBirth", "dateOfBirthRequired",
              "gender", "genderRequired", "nationality", "nationalityRequired",
              "placeOfBirth", "placeOfBirthRequired", "occupation", "occupationRequired",
              "sourceOfFund", "sourceOfFundRequired", "residentCountry", "residentCountryRequired",
              "country", "countryRequired", "regionState", "regionStateRequired",
              "woredaDistrict", "woredaDistrictRequired", "city", "cityRequired",
              "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, $3, $4, $5,
              $6, $7, $8, $9,
              $10, $11, $12, $13,
              $14, $15, $16, $17,
              $18, $19, $20, $21,
              $22, $23, $24, $25,
              $26, $27, $28, $29,
              $30, $31, $32, $33,
              $34, $35, $36, $37,
              NOW(), NOW()
            )
          `;
          await prisma.$executeRawUnsafe(query,
            id, true, true, true, false,
            true, true, false, false,
            false, false, false, false,
            false, false, false, false,
            false, false, false, false,
            false, false, false, false,
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

    // Always normalize so response has consistent booleans (Prisma or raw may return different shapes)
    const out = normalizeSettings(settings);
    const response = {
      success: true,
      data: {
        phoneNumber: out.phoneNumber,
        phoneNumberRequired: out.phoneNumberRequired,
        emailAddress: out.emailAddress,
        emailAddressRequired: out.emailAddressRequired,
        fullName: out.fullName,
        fullNameRequired: out.fullNameRequired,
        middleName: out.middleName,
        middleNameRequired: out.middleNameRequired,
        telephone: out.telephone,
        telephoneRequired: out.telephoneRequired,
        unitApt: out.unitApt,
        unitAptRequired: out.unitAptRequired,
        zipCode: out.zipCode,
        zipCodeRequired: out.zipCodeRequired,
        dateOfBirth: out.dateOfBirth,
        dateOfBirthRequired: out.dateOfBirthRequired,
        gender: out.gender,
        genderRequired: out.genderRequired,
        nationality: out.nationality,
        nationalityRequired: out.nationalityRequired,
        placeOfBirth: out.placeOfBirth,
        placeOfBirthRequired: out.placeOfBirthRequired,
        occupation: out.occupation,
        occupationRequired: out.occupationRequired,
        sourceOfFund: out.sourceOfFund,
        sourceOfFundRequired: out.sourceOfFundRequired,
        residentCountry: out.residentCountry,
        residentCountryRequired: out.residentCountryRequired,
        country: out.country,
        countryRequired: out.countryRequired,
        regionState: out.regionState,
        regionStateRequired: out.regionStateRequired,
        woredaDistrict: out.woredaDistrict,
        woredaDistrictRequired: out.woredaDistrictRequired,
        city: out.city,
        cityRequired: out.cityRequired,
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
    await ensureRegistrationSettingColumns();

    const {
      phoneNumber,
      phoneNumberRequired,
      emailAddress,
      emailAddressRequired,
      fullName,
      fullNameRequired,
      middleName,
      middleNameRequired,
      telephone,
      telephoneRequired,
      unitApt,
      unitAptRequired,
      zipCode,
      zipCodeRequired,
      dateOfBirth,
      dateOfBirthRequired,
      gender,
      genderRequired,
      nationality,
      nationalityRequired,
      placeOfBirth,
      placeOfBirthRequired,
      occupation,
      occupationRequired,
      sourceOfFund,
      sourceOfFundRequired,
      residentCountry,
      residentCountryRequired,
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
    if (middleName !== undefined) updateData.middleName = middleName;
    if (middleNameRequired !== undefined) updateData.middleNameRequired = middleNameRequired;
    if (telephone !== undefined) updateData.telephone = telephone;
    if (telephoneRequired !== undefined) updateData.telephoneRequired = telephoneRequired;
    if (unitApt !== undefined) updateData.unitApt = unitApt;
    if (unitAptRequired !== undefined) updateData.unitAptRequired = unitAptRequired;
    if (zipCode !== undefined) updateData.zipCode = zipCode;
    if (zipCodeRequired !== undefined) updateData.zipCodeRequired = zipCodeRequired;
    if (dateOfBirth !== undefined) updateData.dateOfBirth = dateOfBirth;
    if (dateOfBirthRequired !== undefined) updateData.dateOfBirthRequired = dateOfBirthRequired;
    if (gender !== undefined) updateData.gender = gender;
    if (genderRequired !== undefined) updateData.genderRequired = genderRequired;
    if (nationality !== undefined) updateData.nationality = nationality;
    if (nationalityRequired !== undefined) updateData.nationalityRequired = nationalityRequired;
    if (placeOfBirth !== undefined) updateData.placeOfBirth = placeOfBirth;
    if (placeOfBirthRequired !== undefined) updateData.placeOfBirthRequired = placeOfBirthRequired;
    if (occupation !== undefined) updateData.occupation = occupation;
    if (occupationRequired !== undefined) updateData.occupationRequired = occupationRequired;
    if (sourceOfFund !== undefined) updateData.sourceOfFund = sourceOfFund;
    if (sourceOfFundRequired !== undefined) updateData.sourceOfFundRequired = sourceOfFundRequired;
    if (residentCountry !== undefined) updateData.residentCountry = residentCountry;
    if (residentCountryRequired !== undefined) updateData.residentCountryRequired = residentCountryRequired;
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
          
          // Build the query with proper parameter placeholders (WHERE "id" = $paramIndex)
          const query = `UPDATE "registration_settings" SET ${setClauses.join(', ')} WHERE "id" = $${paramIndex}`;
          await prisma.$executeRawUnsafe(query, ...values);
          
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
            middleName: middleName ?? false,
            middleNameRequired: middleNameRequired ?? false,
            telephone: telephone ?? false,
            telephoneRequired: telephoneRequired ?? false,
            unitApt: unitApt ?? false,
            unitAptRequired: unitAptRequired ?? false,
            zipCode: zipCode ?? false,
            zipCodeRequired: zipCodeRequired ?? false,
            dateOfBirth: dateOfBirth ?? false,
            dateOfBirthRequired: dateOfBirthRequired ?? false,
            gender: gender ?? false,
            genderRequired: genderRequired ?? false,
            nationality: nationality ?? false,
            nationalityRequired: nationalityRequired ?? false,
            placeOfBirth: placeOfBirth ?? false,
            placeOfBirthRequired: placeOfBirthRequired ?? false,
            occupation: occupation ?? false,
            occupationRequired: occupationRequired ?? false,
            sourceOfFund: sourceOfFund ?? false,
            sourceOfFundRequired: sourceOfFundRequired ?? false,
            residentCountry: residentCountry ?? false,
            residentCountryRequired: residentCountryRequired ?? false,
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
              "fullName", "fullNameRequired", "middleName", "middleNameRequired",
              "telephone", "telephoneRequired", "unitApt", "unitAptRequired",
              "zipCode", "zipCodeRequired", "dateOfBirth", "dateOfBirthRequired",
              "gender", "genderRequired", "nationality", "nationalityRequired",
              "placeOfBirth", "placeOfBirthRequired", "occupation", "occupationRequired",
              "sourceOfFund", "sourceOfFundRequired", "residentCountry", "residentCountryRequired",
              "country", "countryRequired", "regionState", "regionStateRequired",
              "woredaDistrict", "woredaDistrictRequired", "city", "cityRequired",
              "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, $3, $4, $5,
              $6, $7, $8, $9,
              $10, $11, $12, $13,
              $14, $15, $16, $17,
              $18, $19, $20, $21,
              $22, $23, $24, $25,
              $26, $27, $28, $29,
              $30, $31, $32, $33,
              $34, $35, $36, $37,
              NOW(), NOW()
            )
          `;
          await prisma.$executeRawUnsafe(query,
            id,
            phoneNumber ?? true, phoneNumberRequired ?? true,
            emailAddress ?? true, emailAddressRequired ?? false,
            fullName ?? true, fullNameRequired ?? true,
            middleName ?? false, middleNameRequired ?? false,
            telephone ?? false, telephoneRequired ?? false,
            unitApt ?? false, unitAptRequired ?? false,
            zipCode ?? false, zipCodeRequired ?? false,
            dateOfBirth ?? false, dateOfBirthRequired ?? false,
            gender ?? false, genderRequired ?? false,
            nationality ?? false, nationalityRequired ?? false,
            placeOfBirth ?? false, placeOfBirthRequired ?? false,
            occupation ?? false, occupationRequired ?? false,
            sourceOfFund ?? false, sourceOfFundRequired ?? false,
            residentCountry ?? false, residentCountryRequired ?? false,
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

    const out = normalizeSettings(settings);
    res.json({
      success: true,
      message: 'Registration settings updated successfully',
      data: {
        phoneNumber: out.phoneNumber,
        phoneNumberRequired: out.phoneNumberRequired,
        emailAddress: out.emailAddress,
        emailAddressRequired: out.emailAddressRequired,
        fullName: out.fullName,
        fullNameRequired: out.fullNameRequired,
        middleName: out.middleName,
        middleNameRequired: out.middleNameRequired,
        telephone: out.telephone,
        telephoneRequired: out.telephoneRequired,
        unitApt: out.unitApt,
        unitAptRequired: out.unitAptRequired,
        zipCode: out.zipCode,
        zipCodeRequired: out.zipCodeRequired,
        dateOfBirth: out.dateOfBirth,
        dateOfBirthRequired: out.dateOfBirthRequired,
        gender: out.gender,
        genderRequired: out.genderRequired,
        nationality: out.nationality,
        nationalityRequired: out.nationalityRequired,
        placeOfBirth: out.placeOfBirth,
        placeOfBirthRequired: out.placeOfBirthRequired,
        occupation: out.occupation,
        occupationRequired: out.occupationRequired,
        sourceOfFund: out.sourceOfFund,
        sourceOfFundRequired: out.sourceOfFundRequired,
        residentCountry: out.residentCountry,
        residentCountryRequired: out.residentCountryRequired,
        country: out.country,
        countryRequired: out.countryRequired,
        regionState: out.regionState,
        regionStateRequired: out.regionStateRequired,
        woredaDistrict: out.woredaDistrict,
        woredaDistrictRequired: out.woredaDistrictRequired,
        city: out.city,
        cityRequired: out.cityRequired,
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
