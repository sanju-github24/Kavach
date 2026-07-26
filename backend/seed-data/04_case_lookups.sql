INSERT INTO CaseCategory (CaseCategoryID, LookupValue) VALUES (1, 'FIR');
INSERT INTO CaseCategory (CaseCategoryID, LookupValue) VALUES (2, 'UDR');
INSERT INTO CaseCategory (CaseCategoryID, LookupValue) VALUES (3, 'Zero FIR');
INSERT INTO CaseCategory (CaseCategoryID, LookupValue) VALUES (4, 'PAR');

INSERT INTO GravityOffence (GravityOffenceID, LookupValue) VALUES (1, 'Heinous');
INSERT INTO GravityOffence (GravityOffenceID, LookupValue) VALUES (2, 'Non-Heinous');

INSERT INTO CaseStatusMaster (CaseStatusID, CaseStatusName) VALUES (1, 'Under Investigation');
INSERT INTO CaseStatusMaster (CaseStatusID, CaseStatusName) VALUES (2, 'Charge Sheeted');
INSERT INTO CaseStatusMaster (CaseStatusID, CaseStatusName) VALUES (3, 'Convicted');
INSERT INTO CaseStatusMaster (CaseStatusID, CaseStatusName) VALUES (4, 'Acquitted');
INSERT INTO CaseStatusMaster (CaseStatusID, CaseStatusName) VALUES (5, 'Closed - FR');
INSERT INTO CaseStatusMaster (CaseStatusID, CaseStatusName) VALUES (6, 'Pending Trial');

INSERT INTO CrimeHead (CrimeHeadID, CrimeGroupName, Active) VALUES (1, 'Crimes Against Body', true);
INSERT INTO CrimeHead (CrimeHeadID, CrimeGroupName, Active) VALUES (2, 'Crimes Against Property', true);
INSERT INTO CrimeHead (CrimeHeadID, CrimeGroupName, Active) VALUES (3, 'Crimes Against Women', true);
INSERT INTO CrimeHead (CrimeHeadID, CrimeGroupName, Active) VALUES (4, 'Economic Offences', true);
INSERT INTO CrimeHead (CrimeHeadID, CrimeGroupName, Active) VALUES (5, 'Narcotics Offences', true);
INSERT INTO CrimeHead (CrimeHeadID, CrimeGroupName, Active) VALUES (6, 'Cyber Crime', true);

INSERT INTO CrimeSubHead (CrimeSubHeadID, CrimeHeadID, CrimeHeadName, SeqID) VALUES (1, 2, 'Theft', 1);
INSERT INTO CrimeSubHead (CrimeSubHeadID, CrimeHeadID, CrimeHeadName, SeqID) VALUES (2, 2, 'Burglary', 2);
INSERT INTO CrimeSubHead (CrimeSubHeadID, CrimeHeadID, CrimeHeadName, SeqID) VALUES (3, 2, 'Robbery', 3);
INSERT INTO CrimeSubHead (CrimeSubHeadID, CrimeHeadID, CrimeHeadName, SeqID) VALUES (4, 2, 'Vehicle Theft', 4);
INSERT INTO CrimeSubHead (CrimeSubHeadID, CrimeHeadID, CrimeHeadName, SeqID) VALUES (5, 2, 'Chain Snatching', 5);
INSERT INTO CrimeSubHead (CrimeSubHeadID, CrimeHeadID, CrimeHeadName, SeqID) VALUES (6, 1, 'Assault', 6);
INSERT INTO CrimeSubHead (CrimeSubHeadID, CrimeHeadID, CrimeHeadName, SeqID) VALUES (7, 1, 'Murder', 7);
INSERT INTO CrimeSubHead (CrimeSubHeadID, CrimeHeadID, CrimeHeadName, SeqID) VALUES (8, 1, 'Kidnapping', 8);
INSERT INTO CrimeSubHead (CrimeSubHeadID, CrimeHeadID, CrimeHeadName, SeqID) VALUES (9, 3, 'Domestic Violence', 9);
INSERT INTO CrimeSubHead (CrimeSubHeadID, CrimeHeadID, CrimeHeadName, SeqID) VALUES (10, 3, 'POCSO', 10);
INSERT INTO CrimeSubHead (CrimeSubHeadID, CrimeHeadID, CrimeHeadName, SeqID) VALUES (11, 4, 'Fraud', 11);
INSERT INTO CrimeSubHead (CrimeSubHeadID, CrimeHeadID, CrimeHeadName, SeqID) VALUES (12, 4, 'Financial Fraud', 12);
INSERT INTO CrimeSubHead (CrimeSubHeadID, CrimeHeadID, CrimeHeadName, SeqID) VALUES (13, 4, 'Smuggling', 13);
INSERT INTO CrimeSubHead (CrimeSubHeadID, CrimeHeadID, CrimeHeadName, SeqID) VALUES (14, 5, 'NDPS', 14);
INSERT INTO CrimeSubHead (CrimeSubHeadID, CrimeHeadID, CrimeHeadName, SeqID) VALUES (15, 6, 'Cyber Crime', 15);
