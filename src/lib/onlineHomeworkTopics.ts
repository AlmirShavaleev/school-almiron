// Physics 11A lessons whose first-part homework is answered on the site.
const onlineHomeworkTopics = new Set([
  '4e85b7d3-f2c5-4771-ad9b-21deca2fdb25',
  '83e3592a-9b61-439a-b992-de21c455cbbb',
  '39a92adc-d2ff-4909-8096-741d9c6f489f',
  '3eea24e1-71b6-445c-a171-81bfd52eb9ba',
  '58c79984-5b43-4018-abe6-1c684f918c7d',
  '71d01f1f-10eb-4fd7-bf4d-11dab44b6758',
  '274e40ac-61a2-4ca2-8398-a9caf1108334',
  'e04f5d4b-4113-48e3-b8a2-f4e3bb81d82a',
  '937407ba-69ee-49ad-b6c1-ef68c821992c',
  '6ca3d457-e56d-456a-acb6-68d227703c8f',
  'dce0152f-bc4e-46e1-a584-740c0d656963',
  '4313ca01-66e0-4b57-ba90-8a101021f7de',
  '7534c3c9-807b-4b3b-9c95-5bfb7a4af349',
  '9291c579-4312-4c79-87bc-f0401e6f6a99',
  '41e8d88d-dea5-4211-92d7-45562c67fda0',
  '92180e53-f1c3-4225-8446-183624c9e803',
  'cf425489-f771-4cf7-b340-ad2adb2eeccc',
  '601fd0ce-11f1-45f4-8d38-bda5be02d6b9',
  '76c9abd7-7c8e-4dfa-8130-29b8aba8b5a2',
  '3034488d-853e-4800-8e20-a1fcfd71ccde',
  '19a6270a-6530-4fb9-b910-eebcf8395e08',
  'bc2a60e1-5d2f-4590-8ec9-23d8f8f7c608',
  '3034efe9-dac8-4cfd-950a-34b1de9fd749',
  'ff9369f4-3a7c-48c1-8393-f621bdb87ef9',
  '66cff4d6-f694-47fb-b88c-07ce5112c008',
])

export function usesOnlineHomework(topicId: string): boolean {
  return onlineHomeworkTopics.has(topicId)
}
